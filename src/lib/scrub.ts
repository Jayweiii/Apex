import type { TelemetryPoint } from "./types";

export type GpsPoint = TelemetryPoint & { lat: number; lon: number };

/** Normalize progress to 0..1. */
export function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Sample a GPS lap at a fractional progress (0..1).
 * Prefers trackDist (map-matched / distance-aligned) when present so chart
 * distance scrubbing lands on the same along-track position as compare series.
 */
export function sampleAtProgress(
  points: GpsPoint[],
  progress: number,
): GpsPoint {
  if (!points.length) {
    return { t: 0, speed: 0, lat: 0, lon: 0 };
  }
  if (points.length === 1) return points[0];
  const p = clampProgress(progress);

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
