import type { TelemetryPoint } from "./types";

export type LatLon = { lat: number; lon: number };

export type MatchedPoint = TelemetryPoint & {
  /** Distance along the centerline from the start (meters). */
  trackDist: number;
  /** Signed lateral offset from the centerline (meters). Positive = left of travel. */
  lateralOffset: number;
  /** Original GPS before snapping (when available). */
  rawLat?: number;
  rawLon?: number;
};

export type GpsDisplayMode = "raw" | "snapped";

const EARTH_M = 6371000;
const MAX_LATERAL_M = 80;
const LOOKAHEAD_SEGMENTS = 40;
const BACKTRACK_SEGMENTS = 4;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLocalMeters(origin: LatLon, point: LatLon) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    x: toRad(point.lon - origin.lon) * EARTH_M * cos,
    y: toRad(point.lat - origin.lat) * EARTH_M,
  };
}

function fromLocalMeters(origin: LatLon, x: number, y: number): LatLon {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    lat: origin.lat + toDeg(y / EARTH_M),
    lon: origin.lon + toDeg(x / (EARTH_M * cos)),
  };
}

export function gpsPoints(points: TelemetryPoint[]): Array<
  TelemetryPoint & { lat: number; lon: number }
> {
  return points.filter(
    (point): point is TelemetryPoint & { lat: number; lon: number } =>
      point.lat != null && point.lon != null,
  );
}

export function parseCenterline(value: unknown): LatLon[] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const out: LatLon[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const lat = Number(record.lat ?? record.latitude);
    const lon = Number(record.lon ?? record.lng ?? record.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ lat, lon });
  }
  return out.length >= 3 ? out : null;
}

function cumulativePathMeters(points: LatLon[]) {
  const dist = [0];
  for (let i = 1; i < points.length; i += 1) {
    dist.push(
      dist[i - 1] +
        haversineMeters(
          points[i - 1].lat,
          points[i - 1].lon,
          points[i].lat,
          points[i].lon,
        ),
    );
  }
  return dist;
}

function resampleByDistance(points: LatLon[], count: number): LatLon[] {
  if (points.length < 2 || count < 2) return points.slice();
  const distances = cumulativePathMeters(points);
  const total = distances[distances.length - 1];
  if (total <= 0) return points.slice(0, count);

  const out: LatLon[] = [];
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1);
    let hi = 1;
    while (hi < distances.length && distances[hi] < target) hi += 1;
    const right = Math.min(hi, points.length - 1);
    const left = Math.max(0, right - 1);
    const span = distances[right] - distances[left];
    const mix = span <= 0 ? 0 : (target - distances[left]) / span;
    out.push({
      lat: points[left].lat + (points[right].lat - points[left].lat) * mix,
      lon: points[left].lon + (points[right].lon - points[left].lon) * mix,
    });
  }
  return out;
}

/** Odd-window quadratic Savitzky–Golay on a 1D series (endpoints mirrored). */
export function savitzkyGolay(values: number[], window = 5): number[] {
  const radius = Math.floor(Math.max(3, window | 1) / 2);
  const size = radius * 2 + 1;
  // Precomputed coefficients for common windows (order 2).
  const coeffs =
    size === 5
      ? [-3, 12, 17, 12, -3].map((c) => c / 35)
      : size === 7
        ? [-2, 3, 6, 7, 6, 3, -2].map((c) => c / 21)
        : [-21, 14, 39, 54, 59, 54, 39, 14, -21].map((c) => c / 231);

  const use = coeffs.length === size ? coeffs : [-3, 12, 17, 12, -3].map((c) => c / 35);
  const r = Math.floor(use.length / 2);
  return values.map((_, index) => {
    let sum = 0;
    for (let k = -r; k <= r; k += 1) {
      const sampleIndex = Math.min(values.length - 1, Math.max(0, index + k));
      sum += values[sampleIndex] * use[k + r];
    }
    return sum;
  });
}

function smoothPolyline(points: LatLon[], window = 5): LatLon[] {
  if (points.length < window) return points.slice();
  const lats = savitzkyGolay(
    points.map((point) => point.lat),
    window,
  );
  const lons = savitzkyGolay(
    points.map((point) => point.lon),
    window,
  );
  return points.map((point, index) => ({
    lat: lats[index],
    lon: lons[index],
  }));
}

function lapLengthMeters(points: TelemetryPoint[]) {
  const gps = gpsPoints(points);
  if (gps.length < 2) return 0;
  return cumulativePathMeters(gps)[gps.length - 1];
}

/**
 * Build a reference centerline by aligning the cleanest (fastest, consistent)
 * laps in distance space, averaging, and smoothing.
 */
export function buildCenterlineFromLaps(
  laps: TelemetryPoint[][],
  options?: { maxPoints?: number; maxLaps?: number },
): LatLon[] | null {
  const maxPoints = options?.maxPoints ?? 240;
  const maxLaps = options?.maxLaps ?? 5;

  const ranked = laps
    .map((points, index) => ({
      index,
      points,
      gps: gpsPoints(points),
      length: lapLengthMeters(points),
      duration:
        points.length > 1
          ? Math.max(0, points[points.length - 1].t - points[0].t)
          : Number.POSITIVE_INFINITY,
    }))
    .filter((lap) => lap.gps.length >= 12 && lap.length > 50)
    .sort((a, b) => a.duration - b.duration || a.length - b.length);

  if (!ranked.length) return null;

  const medianLength = ranked[Math.floor(ranked.length / 2)].length;
  const clean = ranked
    .filter(
      (lap) =>
        Math.abs(lap.length - medianLength) / medianLength < 0.12 ||
        ranked.length === 1,
    )
    .slice(0, maxLaps);

  if (!clean.length) return null;

  const samples = clean.map((lap) => resampleByDistance(lap.gps, maxPoints));
  const averaged: LatLon[] = [];
  for (let i = 0; i < maxPoints; i += 1) {
    let lat = 0;
    let lon = 0;
    for (const sample of samples) {
      lat += sample[i].lat;
      lon += sample[i].lon;
    }
    averaged.push({
      lat: lat / samples.length,
      lon: lon / samples.length,
    });
  }

  return smoothPolyline(averaged, 7);
}

type SegmentProjection = {
  segmentIndex: number;
  t: number;
  distAlong: number;
  lateral: number;
  snapped: LatLon;
  distance: number;
};

function projectOntoSegment(
  origin: LatLon,
  point: LatLon,
  a: LatLon,
  b: LatLon,
  distAtA: number,
  segmentIndex: number,
): SegmentProjection {
  const p = toLocalMeters(origin, point);
  const pa = toLocalMeters(origin, a);
  const pb = toLocalMeters(origin, b);
  const abx = pb.x - pa.x;
  const aby = pb.y - pa.y;
  const len2 = abx * abx + aby * aby;
  const t =
    len2 <= 1e-12
      ? 0
      : Math.min(1, Math.max(0, ((p.x - pa.x) * abx + (p.y - pa.y) * aby) / len2));
  const sx = pa.x + abx * t;
  const sy = pa.y + aby * t;
  const dx = p.x - sx;
  const dy = p.y - sy;
  const cross = abx * dy - aby * dx;
  const segLen = Math.sqrt(len2);
  return {
    segmentIndex,
    t,
    distAlong: distAtA + segLen * t,
    lateral: cross >= 0 ? Math.hypot(dx, dy) : -Math.hypot(dx, dy),
    snapped: fromLocalMeters(origin, sx, sy),
    distance: Math.hypot(dx, dy),
  };
}

/**
 * Snap GPS samples onto a centerline with monotonic along-track progress.
 * Keeps the original coordinates in rawLat/rawLon and stores lateralOffset.
 */
export function snapToCenterline(
  points: TelemetryPoint[],
  centerline: LatLon[],
): MatchedPoint[] {
  if (centerline.length < 2 || !points.length) return [];

  const origin = centerline[0];
  const lineDist = cumulativePathMeters(centerline);
  const total = lineDist[lineDist.length - 1] || 1;
  let cursor = 0;

  return points.map((point) => {
    if (point.lat == null || point.lon == null) {
      return {
        ...point,
        trackDist: (cursor / Math.max(1, centerline.length - 1)) * total,
        lateralOffset: 0,
      };
    }

    const start = Math.max(0, cursor - BACKTRACK_SEGMENTS);
    const end = Math.min(
      centerline.length - 2,
      cursor + LOOKAHEAD_SEGMENTS,
    );

    let best: SegmentProjection | null = null;
    for (let i = start; i <= end; i += 1) {
      const candidate = projectOntoSegment(
        origin,
        { lat: point.lat, lon: point.lon },
        centerline[i],
        centerline[i + 1],
        lineDist[i],
        i,
      );
      // Softly prefer forward progress.
      const progressPenalty =
        i < cursor ? (cursor - i) * 2.5 : Math.max(0, i - cursor - 8) * 0.4;
      const score = candidate.distance + progressPenalty;
      if (
        !best ||
        score <
          best.distance +
            (best.segmentIndex < cursor
              ? (cursor - best.segmentIndex) * 2.5
              : Math.max(0, best.segmentIndex - cursor - 8) * 0.4)
      ) {
        best = candidate;
      }
    }

    // Global fallback if the window missed (first points / large GPS jumps).
    if (!best || best.distance > MAX_LATERAL_M) {
      for (let i = 0; i < centerline.length - 1; i += 1) {
        const candidate = projectOntoSegment(
          origin,
          { lat: point.lat, lon: point.lon },
          centerline[i],
          centerline[i + 1],
          lineDist[i],
          i,
        );
        if (!best || candidate.distance < best.distance) best = candidate;
      }
    }

    if (!best) {
      return {
        ...point,
        trackDist: 0,
        lateralOffset: 0,
        rawLat: point.lat,
        rawLon: point.lon,
      };
    }

    cursor = Math.max(cursor, best.segmentIndex);
    return {
      ...point,
      lat: best.snapped.lat,
      lon: best.snapped.lon,
      trackDist: best.distAlong,
      lateralOffset: best.lateral,
      rawLat: point.lat,
      rawLon: point.lon,
    };
  });
}

/**
 * Light Savitzky–Golay smoothing of speed and along-track position, then
 * re-project lat/lon from smoothed track distance onto the centerline.
 */
export function smoothMatched(
  points: MatchedPoint[],
  centerline: LatLon[],
  options?: { window?: number },
): MatchedPoint[] {
  if (points.length < 5 || centerline.length < 2) return points;

  const window = options?.window ?? (points.length > 200 ? 7 : 5);
  const speeds = savitzkyGolay(
    points.map((point) => point.speed),
    window,
  );
  let trackDists = savitzkyGolay(
    points.map((point) => point.trackDist),
    window,
  );

  // Enforce non-decreasing track distance after smoothing.
  for (let i = 1; i < trackDists.length; i += 1) {
    if (trackDists[i] < trackDists[i - 1]) {
      trackDists[i] = trackDists[i - 1];
    }
  }

  const lineDist = cumulativePathMeters(centerline);
  const total = lineDist[lineDist.length - 1] || 1;

  return points.map((point, index) => {
    const trackDist = Math.min(total, Math.max(0, trackDists[index]));
    let hi = 1;
    while (hi < lineDist.length && lineDist[hi] < trackDist) hi += 1;
    const right = Math.min(hi, centerline.length - 1);
    const left = Math.max(0, right - 1);
    const span = lineDist[right] - lineDist[left];
    const mix = span <= 0 ? 0 : (trackDist - lineDist[left]) / span;
    const lat =
      centerline[left].lat +
      (centerline[right].lat - centerline[left].lat) * mix;
    const lon =
      centerline[left].lon +
      (centerline[right].lon - centerline[left].lon) * mix;
    return {
      ...point,
      speed: Math.max(0, speeds[index]),
      trackDist,
      lat,
      lon,
    };
  });
}

export function mapMatchLap(
  points: TelemetryPoint[],
  centerline: LatLon[] | null | undefined,
): MatchedPoint[] | null {
  if (!centerline || centerline.length < 3) return null;
  if (gpsPoints(points).length < 3) return null;
  const snapped = snapToCenterline(points, centerline);
  return smoothMatched(snapped, centerline);
}

/**
 * Prefer stored/built-in centerlines; otherwise build from sample laps.
 */
export function resolveCenterline(input: {
  stored?: unknown;
  builtin?: LatLon[] | null;
  sampleLaps?: TelemetryPoint[][];
}): LatLon[] | null {
  const stored = parseCenterline(input.stored);
  if (stored) return stored;
  if (input.builtin && input.builtin.length >= 3) return input.builtin;
  if (input.sampleLaps?.length) {
    return buildCenterlineFromLaps(input.sampleLaps);
  }
  return null;
}

/** Points for map rendering: raw GPS or snapped coordinates. */
export function displayPoints(
  matched: MatchedPoint[] | null,
  raw: TelemetryPoint[],
  mode: GpsDisplayMode,
): TelemetryPoint[] {
  if (mode === "raw" || !matched) return raw;
  return matched;
}

/** Points for compare / corners / deltas — prefer snapped with trackDist. */
export function analysisPoints(
  matched: MatchedPoint[] | null,
  raw: TelemetryPoint[],
): TelemetryPoint[] {
  return matched ?? raw;
}
