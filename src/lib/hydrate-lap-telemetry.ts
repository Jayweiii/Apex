/**
 * When stored lap telemetry is too thin for charts (slim Save / botched repair)
 * but sessions.source_gps is dense, rebuild per-lap points by slicing the
 * full-res GPS on each lap's start_offset + duration.
 */
import {
  expandSourceGps,
  isSourceGpsDenseEnough,
} from "@/lib/session-reparse";
import type { TelemetryPoint } from "@/lib/types";

/** Below this, speed charts look empty / stubbed. */
export const MIN_CHART_TELEMETRY_POINTS = 20;

/** Cap per-lap points for UI (matches split-laps downsample). */
export const HYDRATE_MAX_POINTS = 400;

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
 * Returns null when source_gps is missing/coarse or nothing needs fixing.
 */
export function hydrateLapsFromSourceGps<T extends HydrateableLap>(
  laps: T[],
  sourceGps: unknown,
  options: { maxPoints?: number; minPoints?: number } = {},
): T[] | null {
  const maxPoints = options.maxPoints ?? HYDRATE_MAX_POINTS;
  const minPoints = options.minPoints ?? MIN_CHART_TELEMETRY_POINTS;
  if (!lapsNeedTelemetryHydration(laps)) return null;

  const source = expandSourceGps(sourceGps);
  const density = isSourceGpsDenseEnough(source);
  if (!density.ok || source.length < 80) return null;

  const sessionT0 = source[0]!.t;
  return laps.map((lap) => {
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
      Number.isFinite(p.speed),
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
