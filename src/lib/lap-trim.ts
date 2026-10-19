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

/** Session-time span covered by stitched lap telemetry. */
export function sessionDataRange(
  laps: Array<{
    start_offset_sec?: number | null;
    lap_time_ms?: number;
    telemetry?: TelemetryPoint[] | null;
  }>,
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const lap of laps) {
    const base = lap.start_offset_sec ?? 0;
    const telemetry = lap.telemetry ?? [];
    if (telemetry.length) {
      for (const point of telemetry) {
        const t = base + point.t;
        if (t < min) min = t;
        if (t > max) max = t;
      }
    } else {
      const end = base + Math.max(0, (lap.lap_time_ms ?? 0) / 1000);
      if (base < min) min = base;
      if (end > max) max = end;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 0 };
  }
  return { min: roundSec(min), max: roundSec(max) };
}

/**
 * Clamp a proposed trim handle move. Handles move freely both ways;
 * only session data range and start < end (minGap) apply.
 */
export function clampTrimDrag(
  which: "start" | "end",
  proposedSessionT: number,
  current: { start: number; end: number },
  session: { min: number; max: number },
  minGap = 1,
): { start: number; end: number } {
  const gap = Math.max(0.05, minGap);
  if (which === "start") {
    const maxStart = Math.min(session.max, current.end - gap);
    const start = roundSec(
      Math.min(maxStart, Math.max(session.min, proposedSessionT)),
    );
    return { start, end: roundSec(current.end) };
  }
  const minEnd = Math.max(session.min, current.start + gap);
  const end = roundSec(
    Math.min(session.max, Math.max(minEnd, proposedSessionT)),
  );
  return { start: roundSec(current.start), end };
}

/** Stitch sibling laps into session-time telemetry (sorted). */
export function stitchSessionTelemetry(
  laps: Array<{
    start_offset_sec?: number | null;
    telemetry?: TelemetryPoint[] | null;
  }>,
): TelemetryPoint[] {
  const out: TelemetryPoint[] = [];
  for (const lap of laps) {
    const base = lap.start_offset_sec ?? 0;
    for (const point of lap.telemetry ?? []) {
      out.push({ ...point, t: roundSec(base + point.t) });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export type TrimChartPoint = TelemetryPoint & {
  /** False for neighbor padding — render greyed on the speed chart. */
  inLap: boolean;
  /** Null outside the effective trim window (optional orange overlay). */
  speedInTrim?: number | null;
};

/**
 * Build a padded chart series so trim handles have room to drag outward
 * into neighboring session data. Chart-local t starts at 0 = chartOriginSessionT.
 */
export function buildTrimChartContext(
  lap: TrimableLap,
  siblings: Array<{
    id?: string;
    start_offset_sec?: number | null;
    lap_time_ms?: number;
    telemetry?: TelemetryPoint[] | null;
  }>,
  options?: { padSec?: number; minGap?: number },
): {
  points: TrimChartPoint[];
  chartOriginSessionT: number;
  trimStartT: number;
  trimEndT: number;
  sessionMin: number;
  sessionMax: number;
  bounds: LapTrimBounds;
} {
  const bounds = resolveLapTrimBounds(lap);
  const range = sessionDataRange(
    siblings.length ? siblings : [lap],
  );
  const duration = Math.max(1, bounds.autoEnd - bounds.autoStart);
  const pad = options?.padSec ?? Math.max(5, duration * 0.15);
  const windowStart = Math.min(bounds.autoStart, bounds.effectiveStart);
  const windowEnd = Math.max(bounds.autoEnd, bounds.effectiveEnd);
  const chartStart = Math.max(range.min, windowStart - pad);
  const chartEnd = Math.min(range.max, windowEnd + pad);
  const sessionPoints = stitchSessionTelemetry(
    siblings.length ? siblings : [lap],
  );
  const points: TrimChartPoint[] = [];
  for (const point of sessionPoints) {
    if (point.t + 1e-9 < chartStart) continue;
    if (point.t - 1e-9 > chartEnd) continue;
    const inLap =
      point.t + 1e-9 >= bounds.autoStart && point.t - 1e-9 <= bounds.autoEnd;
    const inTrim =
      point.t + 1e-9 >= bounds.effectiveStart &&
      point.t - 1e-9 <= bounds.effectiveEnd;
    points.push({
      ...point,
      t: roundSec(point.t - chartStart),
      inLap,
      speedInTrim: inTrim ? point.speed : null,
    });
  }
  // Ensure at least two points for the chart domain.
  if (points.length < 2) {
    const span = Math.max(0.1, chartEnd - chartStart);
    points.push(
      {
        t: 0,
        speed: lap.telemetry[0]?.speed ?? 0,
        inLap: true,
        speedInTrim: lap.telemetry[0]?.speed ?? 0,
      },
      {
        t: roundSec(span),
        speed: lap.telemetry[lap.telemetry.length - 1]?.speed ?? 0,
        inLap: true,
        speedInTrim: lap.telemetry[lap.telemetry.length - 1]?.speed ?? 0,
      },
    );
  }
  return {
    points,
    chartOriginSessionT: roundSec(chartStart),
    trimStartT: roundSec(bounds.effectiveStart - chartStart),
    trimEndT: roundSec(bounds.effectiveEnd - chartStart),
    sessionMin: range.min,
    sessionMax: range.max,
    bounds,
  };
}

/**
 * Apply trim using full session telemetry when the window extends past the
 * stored lap samples (neighbor padding).
 */
export function applyLapTrimWithSession(
  lap: TrimableLap,
  siblings: Array<{
    start_offset_sec?: number | null;
    telemetry?: TelemetryPoint[] | null;
  }>,
): ReturnType<typeof applyLapTrim> {
  const bounds = resolveLapTrimBounds(lap);
  const { autoStart, autoEnd, effectiveStart, effectiveEnd } = bounds;
  const needsNeighbors =
    effectiveStart + 1e-6 < autoStart || effectiveEnd - 1e-6 > autoEnd;
  if (!needsNeighbors || !siblings.length) {
    return applyLapTrim(lap);
  }
  const sessionPoints = stitchSessionTelemetry(siblings);
  const span = Math.max(0, effectiveEnd - effectiveStart);
  const filtered: TelemetryPoint[] = [];
  for (const point of sessionPoints) {
    if (point.t + 1e-9 < effectiveStart) continue;
    if (point.t - 1e-9 > effectiveEnd) continue;
    filtered.push({
      ...point,
      t: roundSec(point.t - effectiveStart),
    });
  }
  if (filtered.length === 0) {
    return applyLapTrim(lap);
  }
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
  return {
    telemetry: filtered,
    lap_time_ms: Math.max(1, Math.round(span * 1000)),
    start_offset_sec: effectiveStart,
    bounds,
  };
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
