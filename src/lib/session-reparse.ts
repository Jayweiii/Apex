import { splitGoProLaps } from "@/lib/parse-gopro";
import type { LatLon } from "@/lib/map-match";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "@/lib/types";

/**
 * Compact GPS sample stored on sessions.source_gps.
 * s = speed km/h, a = latG, b = lonG (optional).
 */
export type CompactGpsPoint = {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  a?: number;
  b?: number;
};

/** Strip telemetry to GPS essentials for jsonb storage (no video). */
export function compactSourceGps(
  points: TelemetryPoint[],
): CompactGpsPoint[] {
  const out: CompactGpsPoint[] = [];
  for (const p of points) {
    if (
      p.lat == null ||
      p.lon == null ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon)
    ) {
      continue;
    }
    const row: CompactGpsPoint = {
      t: Number(p.t.toFixed(3)),
      lat: Number(p.lat.toFixed(7)),
      lon: Number(p.lon.toFixed(7)),
    };
    if (Number.isFinite(p.speed)) row.s = Number(p.speed.toFixed(2));
    if (p.latG != null && Number.isFinite(p.latG)) {
      row.a = Number(p.latG.toFixed(3));
    }
    if (p.lonG != null && Number.isFinite(p.lonG)) {
      row.b = Number(p.lonG.toFixed(3));
    }
    out.push(row);
  }
  return out;
}

export function expandSourceGps(raw: unknown): TelemetryPoint[] {
  if (!Array.isArray(raw) || !raw.length) return [];
  const out: TelemetryPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const t = Number(row.t);
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (![t, lat, lon].every(Number.isFinite)) continue;
    const point: TelemetryPoint = {
      t,
      speed: Number.isFinite(Number(row.s)) ? Number(row.s) : 0,
      lat,
      lon,
    };
    if (Number.isFinite(Number(row.a))) point.latG = Number(row.a);
    if (Number.isFinite(Number(row.b))) point.lonG = Number(row.b);
    out.push(point);
  }
  return out;
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
    startFinish?: { lat: number; lon: number } | null;
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
};

/**
 * When lap numbers match after re-split, keep exclude/trim flags.
 * YouTube rows remapped by previous lap_number → new lap id.
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
    kept.set(lap.lapNumber, old);
  }
  return kept;
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
