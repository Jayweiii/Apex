/**
 * When stored lap telemetry is too thin for charts (slim Save / botched repair)
 * but sessions.source_gps is dense, rebuild per-lap points by slicing the
 * full-res GPS on each lap's start_offset + duration.
 *
 * Never hydrate from a corrupt source_gps blob (e.g. lon/speed channels that
 * decode to non-physical values) — that replaces usable stubs with empty charts.
 */
import { alignLapBoundariesToSf } from "@/lib/lap-sf-boundary";
import {
  expandSourceGps,
  isSourceGpsDenseEnough,
} from "@/lib/session-reparse";
import type { StartFinishLine } from "@/lib/start-finish-line";
import type { TelemetryPoint } from "@/lib/types";

/** Below this, speed charts look empty / stubbed. */
export const MIN_CHART_TELEMETRY_POINTS = 20;

/** Cap per-lap points for UI (matches split-laps downsample). */
export const HYDRATE_MAX_POINTS = 400;

/** Physical bounds for Thunderhill-class track GPS / road cars. */
const SANE_SPEED_MIN = -2;
const SANE_SPEED_MAX = 400;
const SANE_LAT_MIN = -90;
const SANE_LAT_MAX = 90;
const SANE_LON_MIN = -180;
const SANE_LON_MAX = 180;

export type HydrateableLap = {
  lap_number: number;
  lap_time_ms: number;
  start_offset_sec?: number | null;
  telemetry?: TelemetryPoint[] | null;
};

function downsample(points: TelemetryPoint[], max: number): TelemetryPoint[] {
  if (points.length <= max) return points;
  const result: TelemetryPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    result.push(points[Math.round(i * step)]!);
  }
  return result;
}

/**
 * True when expanded source_gps has usable lat/lon/speed for chart hydration.
 * Rejects known-bad v2 blobs (lon/speed channels decode to nonsense).
 */
export function sourceGpsUsableForHydration(
  points: TelemetryPoint[],
): { ok: boolean; reason?: string } {
  if (points.length < 80) {
    return { ok: false, reason: "too few source points" };
  }
  let sane = 0;
  const sampleEvery = Math.max(1, Math.floor(points.length / 200));
  for (let i = 0; i < points.length; i += sampleEvery) {
    const p = points[i]!;
    if (
      p.lat == null ||
      p.lon == null ||
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lon) ||
      !Number.isFinite(p.speed) ||
      p.lat < SANE_LAT_MIN ||
      p.lat > SANE_LAT_MAX ||
      p.lon < SANE_LON_MIN ||
      p.lon > SANE_LON_MAX ||
      p.speed < SANE_SPEED_MIN ||
      p.speed > SANE_SPEED_MAX
    ) {
      continue;
    }
    sane += 1;
  }
  const sampled = Math.ceil(points.length / sampleEvery);
  if (sane < Math.max(20, Math.floor(sampled * 0.8))) {
    return {
      ok: false,
      reason: `source_gps channels look corrupt (${sane}/${sampled} sane samples)`,
    };
  }
  return { ok: true };
}

/**
 * True when any lap lacks enough samples for a real speed chart.
 */
export function lapsNeedTelemetryHydration(
  laps: HydrateableLap[],
): boolean {
  return laps.some(
    (lap) => (lap.telemetry?.length ?? 0) < MIN_CHART_TELEMETRY_POINTS,
  );
}

/**
 * Slice dense source GPS into lap-local telemetry using stored boundaries.
 * Returns null when source_gps is missing/coarse/corrupt or nothing needs fixing.
 */
export function hydrateLapsFromSourceGps<T extends HydrateableLap>(
  laps: T[],
  sourceGps: unknown,
  options: {
    maxPoints?: number;
    minPoints?: number;
    startFinish?: StartFinishLine | { lat: number; lon: number } | null;
  } = {},
): T[] | null {
  const maxPoints = options.maxPoints ?? HYDRATE_MAX_POINTS;
  const minPoints = options.minPoints ?? MIN_CHART_TELEMETRY_POINTS;
  if (!lapsNeedTelemetryHydration(laps)) return null;

  const source = expandSourceGps(sourceGps);
  const density = isSourceGpsDenseEnough(source);
  if (!density.ok || source.length < 80) return null;
  const usable = sourceGpsUsableForHydration(source);
  if (!usable.ok) return null;

  const sessionT0 = source[0]!.t;
  const hydrated = laps.map((lap) => {
    if ((lap.telemetry?.length ?? 0) >= minPoints) return lap;
    const start = lap.start_offset_sec ?? 0;
    const durationSec = Math.max(0.001, lap.lap_time_ms / 1000);
    const tStart = sessionT0 + start;
    const tEnd = tStart + durationSec;
    const slice = source.filter(
      (p) => p.t + 1e-9 >= tStart && p.t - 1e-9 <= tEnd,
    );
    if (slice.length < 2) return lap;
    const normalized: TelemetryPoint[] = slice.map((p) => ({
      ...p,
      t: Number((p.t - tStart).toFixed(3)),
    }));
    return {
      ...lap,
      telemetry: downsample(normalized, maxPoints),
    };
  });

  if (options.startFinish) {
    return alignLapBoundariesToSf(hydrated, options.startFinish);
  }
  return hydrated;
}

/**
 * Align already-loaded lap telemetry to the SF gate (display / client repair).
 */
export function alignLoadedLapsToSf<T extends HydrateableLap>(
  laps: T[],
  startFinish:
    | StartFinishLine
    | { lat: number; lon: number }
    | null
    | undefined,
): T[] {
  if (!startFinish) return laps;
  return alignLapBoundariesToSf(laps, startFinish);
}

/**
 * Chart height / nonempty contract helpers for tests.
 */
export function speedChartRenderable(
  points: Array<{ t?: number; speed?: number } | null | undefined>,
): { ok: boolean; pointCount: number; reason?: string } {
  const usable = points.filter(
    (p): p is { t: number; speed: number } =>
      !!p &&
      typeof p.t === "number" &&
      Number.isFinite(p.t) &&
      typeof p.speed === "number" &&
      Number.isFinite(p.speed) &&
      p.speed >= SANE_SPEED_MIN &&
      p.speed <= SANE_SPEED_MAX,
  );
  if (usable.length < MIN_CHART_TELEMETRY_POINTS) {
    return {
      ok: false,
      pointCount: usable.length,
      reason: `need ≥${MIN_CHART_TELEMETRY_POINTS} speed samples`,
    };
  }
  const speeds = usable.map((p) => p.speed);
  const span = Math.max(...speeds) - Math.min(...speeds);
  if (!(span > 0.5)) {
    return {
      ok: false,
      pointCount: usable.length,
      reason: "speed values are flat (no chart shape)",
    };
  }
  return { ok: true, pointCount: usable.length };
}
