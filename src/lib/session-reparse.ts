import { splitGoProLaps } from "@/lib/parse-gopro";
import type { LatLon } from "@/lib/map-match";
import {
  compactSourceGps as encodeSourceGps,
  expandSourceGps,
  type CompactGpsPoint,
  type SourceGpsStored,
  type SourceGpsV2,
} from "@/lib/source-gps-codec";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "@/lib/types";

export type { CompactGpsPoint, SourceGpsStored, SourceGpsV2 };
export {
  expandSourceGps,
  sourceGpsPointCount,
  sourceGpsNeedsExternalStorage,
  sourceGpsPayloadBytes,
  SOURCE_GPS_INLINE_MAX_BYTES,
} from "@/lib/source-gps-codec";

/**
 * Full-res GPS → compact v2 jsonb (columnar delta ints, gzip+base64).
 * Never downsamples. Returns null when no usable lat/lon samples.
 */
export function compactSourceGps(
  points: TelemetryPoint[],
): SourceGpsV2 | null {
  return encodeSourceGps(points);
}

/**
 * Only persist source_gps when the track is dense enough to re-split later.
 * Prevents the 144-pt repair bug (stitched downsampled lap telemetry).
 */
export function compactSourceGpsIfDense(
  points: TelemetryPoint[],
): SourceGpsV2 | null {
  const density = isSourceGpsDenseEnough(points);
  if (!density.ok) return null;
  return encodeSourceGps(points);
}

/**
 * Rebuild a session GPS timeline from stored (possibly downsampled) lap rows.
 */
export function stitchLapTelemetry(
  laps: Array<{
    lap_number?: number;
    start_offset_sec?: number | null;
    telemetry?: TelemetryPoint[] | null;
  }>,
): TelemetryPoint[] {
  const ordered = [...laps].sort(
    (a, b) => (a.lap_number ?? 0) - (b.lap_number ?? 0),
  );
  const out: TelemetryPoint[] = [];
  for (const lap of ordered) {
    const offset = Number(lap.start_offset_sec ?? 0);
    const telemetry = lap.telemetry ?? [];
    for (const point of telemetry) {
      out.push({
        ...point,
        t: Number((offset + point.t).toFixed(3)),
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Downsampled lap telemetry (~400 pts / lap) is too coarse to re-detect SF
 * crossings on long sessions. Require ~1.5 Hz over multi-minute traces.
 */
export function isSourceGpsDenseEnough(points: TelemetryPoint[]): {
  ok: boolean;
  hz: number;
  durationSec: number;
  reason?: string;
} {
  if (points.length < 80) {
    return {
      ok: false,
      hz: 0,
      durationSec: 0,
      reason: "Not enough GPS samples to re-split laps.",
    };
  }
  const durationSec = Math.max(
    0,
    points[points.length - 1].t - points[0].t,
  );
  const hz = durationSec > 0 ? (points.length - 1) / durationSec : 0;
  if (durationSec > 120 && hz < 1.5) {
    return {
      ok: false,
      hz,
      durationSec,
      reason:
        "Stored GPS is too coarse for a reliable re-split. Re-select the original GoPro LRV/MP4 or GPS log (GPS only — video is not uploaded).",
    };
  }
  return { ok: true, hz, durationSec };
}

export function resolveGpsForReparse(input: {
  sourceGps?: unknown;
  laps: Array<{
    lap_number?: number;
    start_offset_sec?: number | null;
    telemetry?: TelemetryPoint[] | null;
  }>;
}): {
  points: TelemetryPoint[];
  from: "source_gps" | "stitched_laps";
  density: ReturnType<typeof isSourceGpsDenseEnough>;
} {
  const fromSource = expandSourceGps(input.sourceGps);
  // Prefer stored source_gps whenever it has enough samples to evaluate
  // density — even if coarse (caller shows file picker). Do not fall through
  // to stitched laps and then overwrite source_gps with that coarse stitch.
  if (fromSource.length >= 80) {
    const density = isSourceGpsDenseEnough(fromSource);
    return { points: fromSource, from: "source_gps", density };
  }
  const stitched = stitchLapTelemetry(input.laps);
  const density = isSourceGpsDenseEnough(stitched);
  return { points: stitched, from: "stitched_laps", density };
}

export function reparseLapsFromPoints(
  points: TelemetryPoint[],
  options: {
    sessionStartedAtMs?: number;
    startFinish?: {
      lat: number;
      lon: number;
      headingDeg?: number;
      locked?: boolean;
    } | null;
    centerline?: LatLon[] | null;
    trackId?: string | null;
  } = {},
): { laps: ParsedLap[]; detectedTrackId?: string } {
  return splitGoProLaps(points, options);
}

export type LapSideData = {
  lap_number: number;
  excluded?: boolean | null;
  exclude_reason?: string | null;
  start_offset_override?: number | null;
  end_offset_override?: number | null;
  /** Previous auto session-time start (for stale-trim detection). */
  auto_start?: number | null;
  /** Previous auto session-time end (for stale-trim detection). */
  auto_end?: number | null;
};

/** Auto session-time window for a freshly parsed lap. */
export function autoBoundsForParsedLap(lap: ParsedLap): {
  autoStart: number;
  autoEnd: number;
} {
  const autoStart = lap.startOffsetSec ?? 0;
  const lastT =
    lap.points.length > 0
      ? lap.points[lap.points.length - 1]!.t
      : lap.lapTimeMs / 1000;
  return { autoStart, autoEnd: autoStart + Math.max(0, lastT) };
}

/** Auto session-time window from a stored lap row. */
export function autoBoundsForStoredLap(lap: {
  start_offset_sec?: number | null;
  lap_time_ms?: number | null;
  telemetry?: Array<{ t: number }> | null;
}): { autoStart: number; autoEnd: number } {
  const autoStart = lap.start_offset_sec ?? 0;
  const telemetry = lap.telemetry ?? [];
  const lastT =
    telemetry.length > 0
      ? telemetry[telemetry.length - 1]!.t
      : Math.max(0, (lap.lap_time_ms ?? 0) / 1000);
  return { autoStart, autoEnd: autoStart + lastT };
}

const BOUNDS_CHANGE_TOLERANCE_SEC = 0.5;

/** True when re-split changed the auto window enough that trim is stale. */
export function lapAutoBoundsChanged(
  previous: { autoStart: number; autoEnd: number },
  next: { autoStart: number; autoEnd: number },
  toleranceSec = BOUNDS_CHANGE_TOLERANCE_SEC,
): boolean {
  return (
    Math.abs(previous.autoStart - next.autoStart) > toleranceSec ||
    Math.abs(previous.autoEnd - next.autoEnd) > toleranceSec
  );
}

/**
 * When lap numbers match after re-split, keep exclude flags.
 * Trim overrides are kept only when auto bounds are unchanged — otherwise
 * clear stale start/end overrides that belonged to the old window
 * (e.g. single 20‑min blob → many short laps).
 */
export function preserveMatchedLapSideData(
  previous: LapSideData[],
  nextLaps: ParsedLap[],
): Map<number, LapSideData> {
  const prevByNumber = new Map(
    previous.map((lap) => [lap.lap_number, lap] as const),
  );
  const kept = new Map<number, LapSideData>();
  for (const lap of nextLaps) {
    const old = prevByNumber.get(lap.lapNumber);
    if (!old) continue;
    const nextBounds = autoBoundsForParsedLap(lap);
    const prevBounds =
      old.auto_start != null &&
      old.auto_end != null &&
      Number.isFinite(old.auto_start) &&
      Number.isFinite(old.auto_end)
        ? { autoStart: old.auto_start, autoEnd: old.auto_end }
        : null;
    const boundsChanged = prevBounds
      ? lapAutoBoundsChanged(prevBounds, nextBounds)
      : // No prior auto window (legacy callers) — drop trim if overrides
        // fall far outside the new auto bounds.
        overridesOutsideAutoBounds(old, nextBounds);
    kept.set(lap.lapNumber, {
      lap_number: old.lap_number,
      excluded: old.excluded,
      exclude_reason: old.exclude_reason,
      start_offset_override: boundsChanged
        ? null
        : (old.start_offset_override ?? null),
      end_offset_override: boundsChanged
        ? null
        : (old.end_offset_override ?? null),
      auto_start: nextBounds.autoStart,
      auto_end: nextBounds.autoEnd,
    });
  }
  return kept;
}

/** Overrides that sit well outside the new auto window are treated as stale. */
export function overridesOutsideAutoBounds(
  side: Pick<LapSideData, "start_offset_override" | "end_offset_override">,
  next: { autoStart: number; autoEnd: number },
  padSec = 2,
): boolean {
  const start = side.start_offset_override;
  const end = side.end_offset_override;
  if (start != null && Number.isFinite(start)) {
    if (start < next.autoStart - padSec || start > next.autoEnd + padSec) {
      return true;
    }
  }
  if (end != null && Number.isFinite(end)) {
    if (end < next.autoStart - padSec || end > next.autoEnd + padSec) {
      return true;
    }
  }
  return false;
}

/**
 * Session-level derived stats from laps (respects excludes).
 * Used after re-parse/save so UI + leaderboards agree without a hard refresh.
 */
export function sessionDerivedFromLaps(
  laps: Array<{
    lap_time_ms: number;
    excluded?: boolean | null;
    lap_number?: number;
    points?: TelemetryPoint[];
    telemetry?: TelemetryPoint[] | null;
  }>,
): {
  lapCount: number;
  sessionBestMs: number | null;
  eligibleCount: number;
} {
  const eligible = laps.filter((lap) => !lap.excluded);
  const sessionBestMs = eligible.length
    ? Math.min(...eligible.map((lap) => lap.lap_time_ms))
    : null;
  return {
    lapCount: laps.length,
    sessionBestMs,
    eligibleCount: eligible.length,
  };
}

export function remapVideosByLapNumber(
  videos: SessionVideo[],
  previousLapIdToNumber: Map<string, number>,
  nextLapNumberToId: Map<number, string>,
): SessionVideo[] {
  return videos.map((video) => {
    if (!video.lapId) return video;
    const lapNumber =
      video.lapIndex ?? previousLapIdToNumber.get(video.lapId) ?? null;
    if (lapNumber == null) {
      return { ...video, lapId: null, lapIndex: null };
    }
    const nextId = nextLapNumberToId.get(lapNumber);
    if (!nextId) {
      // Lap number gone after re-split — keep session-level so YouTube survives.
      return { ...video, lapId: null, lapIndex: null };
    }
    return { ...video, lapId: nextId, lapIndex: lapNumber };
  });
}

/** One lap longer than this usually means SF split never ran (full session blob). */
export const UNSPLIT_LAP_HINT_MS = 5 * 60 * 1000;

/** True when the session looks like a single unsplit drive (~5+ min). */
export function looksLikeUnsplitLaps(
  laps: Array<{ lap_time_ms: number }>,
): boolean {
  return laps.length === 1 && laps[0]!.lap_time_ms > UNSPLIT_LAP_HINT_MS;
}

/** Build insert rows for reparsed laps, merging preserved side data. */
export function buildReparsedLapRows(
  userId: string,
  sessionId: string,
  laps: ParsedLap[],
  preserved: Map<number, LapSideData>,
): Array<Record<string, unknown>> {
  return laps.map((lap) => {
    const side = preserved.get(lap.lapNumber);
    return {
      session_id: sessionId,
      user_id: userId,
      lap_number: lap.lapNumber,
      lap_time_ms: lap.lapTimeMs,
      telemetry: lap.points,
      start_offset_sec: lap.startOffsetSec ?? null,
      started_at_ms: lap.startedAtMs ?? null,
      excluded: side?.excluded ?? false,
      exclude_reason: side?.exclude_reason ?? null,
      start_offset_override: side?.start_offset_override ?? null,
      end_offset_override: side?.end_offset_override ?? null,
    };
  });
}
