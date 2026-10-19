/**
 * Lap boundary trimming: owners override start/end session times without
 * destroying original telemetry. Effective views recompute lap time + rebase t.
 */
import type { SessionVideo, TelemetryPoint } from "./types";

export type TrimableLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  start_offset_sec?: number | null;
  telemetry: TelemetryPoint[];
  start_offset_override?: number | null;
  end_offset_override?: number | null;
};

export type LapTrimBounds = {
  /** Auto (original) session-time start. */
  autoStart: number;
  /** Auto (original) session-time end. */
  autoEnd: number;
  /** Effective start after override. */
  effectiveStart: number;
  /** Effective end after override. */
  effectiveEnd: number;
  hasOverride: boolean;
};

function roundSec(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function autoLapBounds(lap: TrimableLap): {
  autoStart: number;
  autoEnd: number;
} {
  const autoStart = lap.start_offset_sec ?? 0;
  const lastT =
    lap.telemetry.length > 0
      ? lap.telemetry[lap.telemetry.length - 1].t
      : lap.lap_time_ms / 1000;
  const durationSec = Math.max(0, lastT);
  return {
    autoStart,
    autoEnd: autoStart + durationSec,
  };
}

export function resolveLapTrimBounds(lap: TrimableLap): LapTrimBounds {
  const { autoStart, autoEnd } = autoLapBounds(lap);
  const start =
    lap.start_offset_override != null && Number.isFinite(lap.start_offset_override)
      ? lap.start_offset_override
      : autoStart;
  const end =
    lap.end_offset_override != null && Number.isFinite(lap.end_offset_override)
      ? lap.end_offset_override
      : autoEnd;
  const effectiveStart = Math.min(start, end);
  const effectiveEnd = Math.max(start, end);
  return {
    autoStart,
    autoEnd,
    effectiveStart,
    effectiveEnd,
    hasOverride:
      lap.start_offset_override != null || lap.end_offset_override != null,
  };
}

/**
 * Filter + rebase telemetry into the effective trim window.
 * Session time for a point = (start_offset_sec ?? 0) + point.t.
 */
export function applyLapTrim(lap: TrimableLap): {
  telemetry: TelemetryPoint[];
  lap_time_ms: number;
  start_offset_sec: number;
  bounds: LapTrimBounds;
} {
  const bounds = resolveLapTrimBounds(lap);
  const base = lap.start_offset_sec ?? 0;
  const { effectiveStart, effectiveEnd } = bounds;
  const span = Math.max(0, effectiveEnd - effectiveStart);

  if (!lap.telemetry.length) {
    return {
      telemetry: [],
      lap_time_ms: Math.round(span * 1000),
      start_offset_sec: effectiveStart,
      bounds,
    };
  }

  const filtered: TelemetryPoint[] = [];
  for (const point of lap.telemetry) {
    const sessionT = base + point.t;
    if (sessionT + 1e-9 < effectiveStart) continue;
    if (sessionT - 1e-9 > effectiveEnd) continue;
    filtered.push({
      ...point,
      t: roundSec(sessionT - effectiveStart),
    });
  }

  // Ensure endpoints exist when the window cuts between samples.
  if (filtered.length === 0) {
    // Fall back: interpolate nearest by clamping to available range.
    const first = lap.telemetry[0];
    const last = lap.telemetry[lap.telemetry.length - 1];
    filtered.push(
      { ...first, t: 0 },
      { ...last, t: roundSec(span) },
    );
  } else {
    if (filtered[0].t > 0.05) {
      filtered.unshift({ ...filtered[0], t: 0 });
    } else {
      filtered[0] = { ...filtered[0], t: 0 };
    }
    const last = filtered[filtered.length - 1];
    if (Math.abs(last.t - span) > 0.05) {
      filtered.push({ ...last, t: roundSec(span) });
    } else {
      filtered[filtered.length - 1] = { ...last, t: roundSec(span) };
    }
  }

  return {
    telemetry: filtered,
    lap_time_ms: Math.max(1, Math.round(span * 1000)),
    start_offset_sec: effectiveStart,
    bounds,
  };
}

export function nudgeTrimBound(
  current: number,
  deltaSec: number,
  min: number,
  max: number,
): number {
  return roundSec(Math.min(max, Math.max(min, current + deltaSec)));
}

/**
 * When the effective lap start shifts by `deltaSec`, keep dedicated lap
 * videos showing the same frame at progress 0 by shifting offsetSec.
 */
export function videoOffsetAfterStartShift(
  video: Pick<SessionVideo, "offsetSec" | "lapId">,
  lapId: string,
  deltaSec: number,
): number {
  if (!video.lapId || video.lapId !== lapId) return video.offsetSec;
  return roundSec(video.offsetSec + deltaSec);
}

/** Merge lap A with the next adjacent lap (by lap_number). */
export function mergeAdjacentLaps(
  laps: TrimableLap[],
  firstId: string,
): TrimableLap[] | null {
  const ordered = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const idx = ordered.findIndex((lap) => lap.id === firstId);
  if (idx < 0 || idx >= ordered.length - 1) return null;
  const a = applyLapTrim(ordered[idx]);
  const b = applyLapTrim(ordered[idx + 1]);
  const gap = Math.max(0, b.start_offset_sec - (a.start_offset_sec + a.lap_time_ms / 1000));
  const mergedTelemetry: TelemetryPoint[] = [
    ...a.telemetry,
    ...b.telemetry.map((point) => ({
      ...point,
      t: roundSec(point.t + a.lap_time_ms / 1000 + gap),
    })),
  ];
  const merged: TrimableLap = {
    ...ordered[idx],
    lap_time_ms: Math.round(
      (mergedTelemetry[mergedTelemetry.length - 1]?.t ?? 0) * 1000,
    ),
    start_offset_sec: a.start_offset_sec,
    start_offset_override: null,
    end_offset_override: null,
    telemetry: mergedTelemetry,
  };
  const rest = ordered.filter((_, i) => i !== idx && i !== idx + 1);
  const next = [...rest, merged].sort((x, y) => x.lap_number - y.lap_number);
  // Renumber sequentially.
  return next.map((lap, i) => ({ ...lap, lap_number: i + 1 }));
}

/** Split a lap at progress 0..1 into two adjacent laps. */
export function splitLapAtProgress(
  laps: TrimableLap[],
  lapId: string,
  progress: number,
): TrimableLap[] | null {
  const ordered = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const idx = ordered.findIndex((lap) => lap.id === lapId);
  if (idx < 0) return null;
  const applied = applyLapTrim(ordered[idx]);
  if (applied.telemetry.length < 4) return null;
  const p = Math.min(0.95, Math.max(0.05, progress));
  const splitT = applied.telemetry[0].t + p * (applied.lap_time_ms / 1000);
  const leftPoints = applied.telemetry
    .filter((point) => point.t <= splitT + 1e-6)
    .map((point) => ({ ...point }));
  const rightPoints = applied.telemetry
    .filter((point) => point.t >= splitT - 1e-6)
    .map((point) => ({
      ...point,
      t: roundSec(point.t - splitT),
    }));
  if (leftPoints.length < 2 || rightPoints.length < 2) return null;
  leftPoints[leftPoints.length - 1] = {
    ...leftPoints[leftPoints.length - 1],
    t: roundSec(splitT),
  };
  rightPoints[0] = { ...rightPoints[0], t: 0 };

  const left: TrimableLap = {
    ...ordered[idx],
    lap_time_ms: Math.round(splitT * 1000),
    start_offset_sec: applied.start_offset_sec,
    start_offset_override: null,
    end_offset_override: null,
    telemetry: leftPoints,
  };
  const right: TrimableLap = {
    id: `${ordered[idx].id}-split-${Date.now()}`,
    lap_number: ordered[idx].lap_number + 1,
    lap_time_ms: Math.round(
      (rightPoints[rightPoints.length - 1]?.t ?? 0) * 1000,
    ),
    start_offset_sec: applied.start_offset_sec + splitT,
    start_offset_override: null,
    end_offset_override: null,
    telemetry: rightPoints,
  };

  const rest = ordered.filter((_, i) => i !== idx);
  const next = [...rest, left, right].sort(
    (x, y) => x.start_offset_sec! - y.start_offset_sec!,
  );
  return next.map((lap, i) => ({ ...lap, lap_number: i + 1 }));
}

export function clearLapTrimOverrides(lap: TrimableLap): TrimableLap {
  return {
    ...lap,
    start_offset_override: null,
    end_offset_override: null,
  };
}
