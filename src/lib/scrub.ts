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

function mixNumber(a?: number, b?: number, mix = 0) {
  const left = a ?? 0;
  const right = b ?? left;
  return left + (right - left) * mix;
}

function mixPoint(left: GpsPoint, right: GpsPoint, mix: number): GpsPoint {
  const out: GpsPoint = {
    ...right,
    t: mixNumber(left.t, right.t, mix),
    speed: mixNumber(left.speed, right.speed, mix),
    lat: mixNumber(left.lat, right.lat, mix),
    lon: mixNumber(left.lon, right.lon, mix),
    latG: mixNumber(left.latG, right.latG, mix),
    lonG: mixNumber(left.lonG, right.lonG, mix),
    g: mixNumber(left.g, right.g, mix),
    rawLat: left.rawLat != null ? mixNumber(left.rawLat, right.rawLat, mix) : undefined,
    rawLon: left.rawLon != null ? mixNumber(left.rawLon, right.rawLon, mix) : undefined,
  };
  // Never invent trackDist=0 — that made timeGapAtProgress return −elapsed.
  if (left.trackDist != null || right.trackDist != null) {
    out.trackDist = mixNumber(left.trackDist, right.trackDist, mix);
  } else {
    delete out.trackDist;
  }
  if (left.lateralOffset != null || right.lateralOffset != null) {
    out.lateralOffset = mixNumber(left.lateralOffset, right.lateralOffset, mix);
  } else {
    delete out.lateralOffset;
  }
  return out;
}

/** Cumulative path length (m) from lap start to each sample. */
export function pathDistancesMeters(points: GpsPoint[]): number[] {
  if (!points.length) return [];
  const out = [0];
  let dist = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    const dLat = next.lat - prev.lat;
    const dLon = next.lon - prev.lon;
    // Equirectangular meters — good enough for along-track lookups.
    const latMid = ((prev.lat + next.lat) / 2) * (Math.PI / 180);
    const meters =
      Math.hypot(dLat * 111_320, dLon * 111_320 * Math.cos(latMid)) || 0;
    dist += meters;
    out.push(dist);
  }
  return out;
}

/** Path meters at elapsed time t (haversine cumulative). */
export function pathDistanceAtTime(points: GpsPoint[], t: number): number {
  if (points.length < 2) return 0;
  const dists = pathDistancesMeters(points);
  if (t <= points[0]!.t) return 0;
  const last = points[points.length - 1]!;
  if (t >= last.t) return dists[dists.length - 1] ?? 0;
  let hi = 1;
  while (hi < points.length && points[hi]!.t < t) hi += 1;
  const right = Math.min(hi, points.length - 1);
  const left = Math.max(0, right - 1);
  const span = points[right]!.t - points[left]!.t;
  const mix = span <= 0 ? 0 : (t - points[left]!.t) / span;
  return (dists[left] ?? 0) + ((dists[right] ?? 0) - (dists[left] ?? 0)) * mix;
}

/** Time when cumulative path length reaches `dist` meters. */
export function timeAtPathDistance(
  points: GpsPoint[],
  dist: number,
): number | null {
  if (points.length < 2 || !Number.isFinite(dist)) return null;
  const dists = pathDistancesMeters(points);
  const end = dists[dists.length - 1] ?? 0;
  const target = Math.min(Math.max(dist, 0), end);
  let hi = 1;
  while (hi < dists.length && (dists[hi] ?? 0) < target) hi += 1;
  const right = Math.min(hi, points.length - 1);
  const left = Math.max(0, right - 1);
  const leftD = dists[left] ?? 0;
  const rightD = dists[right] ?? leftD;
  const span = rightD - leftD;
  const mix = span <= 0 ? 0 : (target - leftD) / span;
  return points[left]!.t + (points[right]!.t - points[left]!.t) * mix;
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
 * (prefers trackDist; falls back to cumulative path meters — never treats
 * meters as a 0..1 fraction).
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
  return timeAtPathDistance(points, dist);
}

/**
 * Time gap at shared elapsed time t (progress × duration).
 *
 * For the compared lap at time t, find its distance d; gap =
 *   t_ref(d) − t
 * Negative ⇒ compared lap is behind (ref reached that distance earlier).
 * Never returns ≈ −elapsed from a fake trackDist=0.
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
  const otherPt = sampleAtProgress(other, progress, options);
  const t = otherPt.t;
  if (!Number.isFinite(t)) return null;

  const bothTrack =
    ref.some((p) => p.trackDist != null) &&
    other.some((p) => p.trackDist != null);

  let dist: number | null = null;
  if (bothTrack && otherPt.trackDist != null && Number.isFinite(otherPt.trackDist)) {
    dist = otherPt.trackDist;
  } else {
    dist = pathDistanceAtTime(other, t);
  }
  if (dist == null || !Number.isFinite(dist)) return null;

  const refT = bothTrack
    ? timeAtDistance(ref, dist)
    : timeAtPathDistance(ref, dist);
  if (refT == null || !Number.isFinite(refT)) return null;
  return refT - t;
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
