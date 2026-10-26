/**
 * Shared lap playback time base.
 *
 * progress 0..1 ≡ milliseconds from the interpolated lap start
 * (SF crossing / first sample t0) through durationMs.
 *
 * Map markers, charts, and video sync all sample on this timeline —
 * never index fraction or trackDist fraction for session playback.
 */
import { clampProgress, type GpsPoint } from "@/lib/scrub";
import type { TelemetryPoint } from "@/lib/types";

export type TimedPoint = Pick<TelemetryPoint, "t"> & Partial<TelemetryPoint>;

/** Authoritative lap length in seconds for the shared clock. */
export function lapDurationSec(lapTimeMs: number): number {
  return Math.max(0.001, lapTimeMs / 1000);
}

/** Series start time (usually 0 after SF-interpolated split). */
export function seriesT0(points: TimedPoint[]): number {
  return points[0]?.t ?? 0;
}

/**
 * End of the playback window. Prefer durationMs (lap_time_ms) so the clock,
 * charts, and video agree even when the last densified sample's `t` drifts.
 */
export function seriesTEnd(
  points: TimedPoint[],
  durationSec?: number,
): number {
  const t0 = seriesT0(points);
  if (durationSec != null && durationSec > 0) return t0 + durationSec;
  if (points.length) return points[points.length - 1]!.t;
  return t0 + 1;
}

/** progress 0..1 → lap-local seconds. */
export function timeSecFromProgress(
  progress: number,
  durationSec: number,
  t0 = 0,
): number {
  return t0 + clampProgress(progress) * Math.max(0.001, durationSec);
}

/** lap-local seconds → progress 0..1. */
export function progressFromTimeSec(
  t: number,
  durationSec: number,
  t0 = 0,
): number {
  return clampProgress((t - t0) / Math.max(0.001, durationSec));
}

/** Plot X fraction for a time within the drawn domain [firstT, lastT]. */
export function plotFractionFromTime(
  t: number,
  firstT: number,
  lastT: number,
): number {
  const span = lastT - firstT;
  if (!(span > 0) || !Number.isFinite(span)) return 0;
  return clampProgress((t - firstT) / span);
}

function mixNumber(a: number | undefined, b: number | undefined, mix: number) {
  const left = a ?? 0;
  const right = b ?? left;
  return left + (right - left) * mix;
}

/**
 * Interpolate a telemetry/GPS sample at lap-local time `t` (seconds).
 * Matches video-sync.interpolatePoint so map/chart/video share one sample.
 */
export function sampleAtTime<T extends TimedPoint>(points: T[], t: number): T {
  if (!points.length) {
    return { t: 0, speed: 0 } as T;
  }
  if (points.length === 1 || t <= (points[0]!.t ?? 0)) {
    return { ...points[0]!, t: points[0]!.t ?? 0 };
  }
  const last = points[points.length - 1]!;
  if (t >= (last.t ?? 0)) {
    return { ...last, t: last.t ?? t };
  }
  let hi = 1;
  while (hi < points.length && (points[hi]!.t ?? 0) < t) hi += 1;
  const right = points[Math.min(hi, points.length - 1)]!;
  const left = points[Math.max(0, hi - 1)]!;
  const span = (right.t ?? 0) - (left.t ?? 0);
  const mix = span <= 0 ? 0 : (t - (left.t ?? 0)) / span;
  const out: TimedPoint = {
    ...right,
    t,
    speed: mixNumber(left.speed, right.speed, mix),
  };
  if (left.lat != null || right.lat != null) {
    out.lat = mixNumber(left.lat, right.lat, mix);
  }
  if (left.lon != null || right.lon != null) {
    out.lon = mixNumber(left.lon, right.lon, mix);
  }
  if (left.latG != null || right.latG != null) {
    out.latG = mixNumber(left.latG, right.latG, mix);
  }
  if (left.lonG != null || right.lonG != null) {
    out.lonG = mixNumber(left.lonG, right.lonG, mix);
  }
  if (left.g != null || right.g != null) {
    out.g = mixNumber(left.g, right.g, mix);
  }
  if (left.trackDist != null || right.trackDist != null) {
    out.trackDist = mixNumber(left.trackDist, right.trackDist, mix);
  }
  if (left.lateralOffset != null || right.lateralOffset != null) {
    out.lateralOffset = mixNumber(left.lateralOffset, right.lateralOffset, mix);
  }
  if (left.rawLat != null || right.rawLat != null) {
    out.rawLat = mixNumber(left.rawLat, right.rawLat, mix);
  }
  if (left.rawLon != null || right.rawLon != null) {
    out.rawLon = mixNumber(left.rawLon, right.rawLon, mix);
  }
  return out as T;
}

/** Sample GPS by shared playback progress (time base, not trackDist/index). */
export function sampleAtTimeProgress(
  points: GpsPoint[],
  progress: number,
  durationSec: number,
  t0?: number,
): GpsPoint {
  const start = t0 ?? seriesT0(points);
  const t = timeSecFromProgress(progress, durationSec, start);
  return sampleAtTime(points, t);
}

/** Nearest series index for a lap-local time (chart cursor / readout). */
export function indexNearestTime(points: TimedPoint[], t: number): number {
  if (points.length < 2) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const dist = Math.abs((points[i]!.t ?? 0) - t);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export function indexFromTimeProgress(
  points: TimedPoint[],
  progress: number,
  durationSec: number,
  t0?: number,
): number | null {
  if (points.length < 2) return null;
  const start = t0 ?? seriesT0(points);
  const t = timeSecFromProgress(progress, durationSec, start);
  return indexNearestTime(points, t);
}

/**
 * Map click → shared time progress from the nearest GPS sample's `t`.
 */
export function progressNearPointTime(
  points: GpsPoint[],
  lat: number,
  lon: number,
  distanceMeters: (
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number,
  ) => number,
  durationSec: number,
  t0?: number,
): { progress: number; distance: number } {
  if (points.length < 2) {
    return { progress: 0, distance: Number.POSITIVE_INFINITY };
  }
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let i = 0; i < points.length; i += 1) {
    const distance = distanceMeters(lat, lon, points[i]!.lat, points[i]!.lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const start = t0 ?? seriesT0(points);
  return {
    progress: progressFromTimeSec(points[bestIndex]!.t, durationSec, start),
    distance: bestDistance,
  };
}
