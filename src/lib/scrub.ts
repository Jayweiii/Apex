import type { TelemetryPoint } from "./types";

export type GpsPoint = TelemetryPoint & { lat: number; lon: number };

/** Normalize progress to 0..1. */
export function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Sample a GPS lap at a fractional progress (0..1).
 *
 * - `basis: "time"` (session + compare playback): interpolate by lap-local `t`
 *   so map/charts/video share elapsed ms from lap start. Requires `durationSec`
 *   (shared max lap for compare).
 * - `basis: "track"` / default: prefers trackDist (optional distance align),
 *   else index fraction.
 */
export function sampleAtProgress(
  points: GpsPoint[],
  progress: number,
  options?: {
    basis?: "time" | "track";
    durationSec?: number;
    t0?: number;
  },
): GpsPoint {
  if (!points.length) {
    return { t: 0, speed: 0, lat: 0, lon: 0 };
  }
  if (points.length === 1) return points[0];
  const p = clampProgress(progress);

  if (options?.basis === "time") {
    const t0 = options.t0 ?? points[0]!.t;
    const durationSec =
      options.durationSec != null && options.durationSec > 0
        ? options.durationSec
        : Math.max(0.001, points[points.length - 1]!.t - t0);
    const targetT = t0 + p * durationSec;
    let hi = 1;
    while (hi < points.length && points[hi]!.t < targetT) hi += 1;
    const right = Math.min(hi, points.length - 1);
    const left = Math.max(0, right - 1);
    const span = points[right]!.t - points[left]!.t;
    const mix = span <= 0 ? 0 : (targetT - points[left]!.t) / span;
    return mixPoint(points[left]!, points[right]!, mix);
  }

  const hasTrackDist = points.some((point) => point.trackDist != null);
  if (hasTrackDist) {
    const start = points[0].trackDist ?? 0;
    const end = points[points.length - 1].trackDist ?? start;
    const target = start + p * Math.max(0, end - start);
    let hi = 1;
    while (hi < points.length && (points[hi].trackDist ?? 0) < target) hi += 1;
    const right = Math.min(hi, points.length - 1);
    const left = Math.max(0, right - 1);
    const leftDist = points[left].trackDist ?? 0;
    const rightDist = points[right].trackDist ?? leftDist;
    const span = rightDist - leftDist;
    const mix = span <= 0 ? 0 : (target - leftDist) / span;
    return mixPoint(points[left], points[right], mix);
  }

  const position = p * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const mix = position - index;
  return mixPoint(points[index], points[index + 1], mix);
}

function mixPoint(left: GpsPoint, right: GpsPoint, mix: number): GpsPoint {
  const mixNumber = (a?: number, b?: number) =>
    (a ?? 0) + ((b ?? 0) - (a ?? 0)) * mix;
  return {
    ...right,
    t: mixNumber(left.t, right.t),
    speed: mixNumber(left.speed, right.speed),
    lat: mixNumber(left.lat, right.lat),
    lon: mixNumber(left.lon, right.lon),
    latG: mixNumber(left.latG, right.latG),
    lonG: mixNumber(left.lonG, right.lonG),
    g: mixNumber(left.g, right.g),
    trackDist: mixNumber(left.trackDist, right.trackDist),
    lateralOffset: mixNumber(left.lateralOffset, right.lateralOffset),
    rawLat: left.rawLat != null ? mixNumber(left.rawLat, right.rawLat) : undefined,
    rawLon: left.rawLon != null ? mixNumber(left.rawLon, right.rawLon) : undefined,
  };
}

/** Progress 0..1 for the nearest sample to a lat/lon. */
export function progressNearPoint(
  points: GpsPoint[],
  lat: number,
  lon: number,
  distanceMeters: (aLat: number, aLon: number, bLat: number, bLon: number) => number,
  options?: {
    basis?: "time" | "track";
    durationSec?: number;
    t0?: number;
  },
): { progress: number; distance: number } {
  if (points.length < 2) return { progress: 0, distance: Number.POSITIVE_INFINITY };
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIndex = 0;
  for (let i = 0; i < points.length; i += 1) {
    const distance = distanceMeters(lat, lon, points[i].lat, points[i].lon);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }

  if (options?.basis === "time") {
    const t0 = options.t0 ?? points[0]!.t;
    const durationSec =
      options.durationSec != null && options.durationSec > 0
        ? options.durationSec
        : Math.max(0.001, points[points.length - 1]!.t - t0);
    return {
      progress: clampProgress((points[bestIndex]!.t - t0) / durationSec),
      distance: bestDistance,
    };
  }

  const hasTrackDist = points.some((point) => point.trackDist != null);
  if (hasTrackDist) {
    const start = points[0].trackDist ?? 0;
    const end = points[points.length - 1].trackDist ?? start;
    const span = Math.max(1e-6, end - start);
    const at = points[bestIndex].trackDist ?? start;
    return {
      progress: clampProgress((at - start) / span),
      distance: bestDistance,
    };
  }

  return {
    progress: clampProgress(bestIndex / (points.length - 1)),
    distance: bestDistance,
  };
}

/**
 * Time (seconds) when a lap reaches along-track distance `dist`
 * (prefers trackDist; falls back to cumulative path fraction).
 */
export function timeAtDistance(
  points: GpsPoint[],
  dist: number,
): number | null {
  if (points.length < 2 || !Number.isFinite(dist)) return null;
  const hasTrackDist = points.some((point) => point.trackDist != null);
  if (hasTrackDist) {
    const start = points[0]!.trackDist ?? 0;
    const end = points[points.length - 1]!.trackDist ?? start;
    const target = Math.min(Math.max(dist, start), end);
    let hi = 1;
    while (hi < points.length && (points[hi]!.trackDist ?? 0) < target) hi += 1;
    const right = Math.min(hi, points.length - 1);
    const left = Math.max(0, right - 1);
    const leftDist = points[left]!.trackDist ?? 0;
    const rightDist = points[right]!.trackDist ?? leftDist;
    const span = rightDist - leftDist;
    const mix = span <= 0 ? 0 : (target - leftDist) / span;
    return points[left]!.t + (points[right]!.t - points[left]!.t) * mix;
  }
  // No trackDist: use index fraction of the lap as a crude distance proxy.
  const position = clampProgress(dist) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const mix = position - index;
  return points[index]!.t + (points[index + 1]!.t - points[index]!.t) * mix;
}

/**
 * Time gap (seconds) at the same place on track: other.t(d_ref) − ref.t.
 * Positive ⇒ other is behind at ref's current distance.
 * For time-aligned playback both samples share elapsed t, so raw t−t is ~0 —
 * this looks up when the other car reached ref's distance instead.
 */
export function timeGapAtProgress(
  ref: GpsPoint[],
  other: GpsPoint[],
  progress: number,
  options?: {
    basis?: "time" | "track";
    durationSec?: number;
    t0?: number;
  },
): number | null {
  if (ref.length < 2 || other.length < 2) return null;
  const refPt = sampleAtProgress(ref, progress, options);
  const refDist = refPt.trackDist;
  if (refDist == null || !Number.isFinite(refDist)) {
    // Fall back to spatial proximity: nearest other sample to ref position.
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i < other.length; i += 1) {
      const d =
        (other[i]!.lat - refPt.lat) ** 2 + (other[i]!.lon - refPt.lon) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const gap = other[best]!.t - refPt.t;
    return Number.isFinite(gap) ? gap : null;
  }
  const otherT = timeAtDistance(other, refDist);
  if (otherT == null || !Number.isFinite(otherT)) return null;
  return otherT - refPt.t;
}

/** Map a chart series index to shared 0..1 progress. */
export function progressFromIndex(index: number | null, length: number) {
  if (index == null || length < 2) return null;
  return clampProgress(index / (length - 1));
}

/** Map shared progress back to a chart series index. */
export function indexFromProgress(progress: number | null, length: number) {
  if (progress == null || length < 2) return null;
  return Math.round(clampProgress(progress) * (length - 1));
}
