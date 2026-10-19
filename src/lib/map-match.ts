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
/** Reject projections farther than this from any segment (meters). */
const MAX_EMIT_LATERAL_M = 40;
/**
 * Max lateral pull from raw GPS toward the centerline (meters).
 * A centerline is not a racing line — we snap along-track progress and only
 * lightly damp GPS noise; never collapse the path onto the reference.
 */
export const MAX_LATERAL_CORRECTION_M = 2;
/** Treat projections farther than this as spikes (meters). */
const SPIKE_LATERAL_M = 22;
const CANDIDATES_PER_SAMPLE = 8;
const TOP_K = 6;

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
    const mix = span <= 0 ? 0 : (distances[left] === undefined ? 0 : (target - distances[left]) / span);
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
  return points.map((_, index) => ({
    lat: lats[index],
    lon: lons[index],
  }));
}

/** Close a near-loop polyline by blending ends when the gap is small. */
export function closeLoop(points: LatLon[], maxGapM = 40): LatLon[] {
  if (points.length < 4) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  const gap = haversineMeters(first.lat, first.lon, last.lat, last.lon);
  if (gap <= 1e-3) return points.slice();
  if (gap > maxGapM) {
    // Still append first for topological closure when building a track loop.
    return [...points, { ...first }];
  }
  const blend = Math.min(6, Math.floor(points.length / 20));
  const out = points.map((point) => ({ ...point }));
  for (let i = 0; i < blend; i += 1) {
    const w = (i + 1) / (blend + 1);
    const j = out.length - 1 - i;
    out[j] = {
      lat: out[j].lat * (1 - w) + first.lat * w,
      lon: out[j].lon * (1 - w) + first.lon * w,
    };
    out[i] = {
      lat: out[i].lat * (1 - w) + last.lat * w,
      lon: out[i].lon * (1 - w) + last.lon * w,
    };
  }
  out.push({ ...out[0] });
  return out;
}

function lapLengthMeters(points: TelemetryPoint[]) {
  const gps = gpsPoints(points);
  if (gps.length < 2) return 0;
  return cumulativePathMeters(gps)[gps.length - 1];
}

/**
 * Build a reference centerline from the cleanest single lap (fastest with
 * consistent length), densely resampled, lightly smoothed, loop-closed.
 * Averaging multiple laps pulls the line off the racing line — avoid that.
 */
export function buildCenterlineFromLaps(
  laps: TelemetryPoint[][],
  options?: { maxPoints?: number; maxLaps?: number },
): LatLon[] | null {
  const maxPoints = options?.maxPoints ?? 480;

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
  const cleanest =
    ranked.find(
      (lap) =>
        Math.abs(lap.length - medianLength) / Math.max(1, medianLength) < 0.12,
    ) ?? ranked[0];

  const dense = resampleByDistance(cleanest.gps, maxPoints);
  // Very light smooth only — heavy SG shaves apexes.
  const smoothed = smoothPolyline(dense, 5);
  return closeLoop(smoothed);
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

/** Offset a point on the centerline by signed lateral meters (left of travel +). */
export function offsetFromCenterline(
  centerline: LatLon[],
  lineDist: number[],
  trackDist: number,
  lateralM: number,
): LatLon {
  const total = lineDist[lineDist.length - 1] || 1;
  const s = Math.min(total, Math.max(0, trackDist));
  let hi = 1;
  while (hi < lineDist.length && lineDist[hi] < s) hi += 1;
  const right = Math.min(hi, centerline.length - 1);
  const left = Math.max(0, right - 1);
  const span = lineDist[right] - lineDist[left];
  const mix = span <= 0 ? 0 : (s - lineDist[left]) / span;
  const a = centerline[left];
  const b = centerline[right];
  const origin = centerline[0];
  const pa = toLocalMeters(origin, a);
  const pb = toLocalMeters(origin, b);
  const abx = pb.x - pa.x;
  const aby = pb.y - pa.y;
  const len = Math.hypot(abx, aby) || 1;
  // Left normal of travel direction.
  const nx = -aby / len;
  const ny = abx / len;
  const cx = pa.x + abx * mix + nx * lateralM;
  const cy = pa.y + aby * mix + ny * lateralM;
  return fromLocalMeters(origin, cx, cy);
}

/**
 * Move `from` toward `toward` by at most `cap` meters.
 * Used for spike damping (pull raw → matched segment) without collapsing
 * the racing line onto the centerline.
 */
export function lightCorrectTowardCenterline(
  origin: LatLon,
  from: LatLon,
  toward: LatLon,
  cap = MAX_LATERAL_CORRECTION_M,
): LatLon {
  const p = toLocalMeters(origin, from);
  const c = toLocalMeters(origin, toward);
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-9) return { ...from };
  const pull = Math.min(cap, dist);
  const t = pull / dist;
  return fromLocalMeters(origin, p.x + dx * t, p.y + dy * t);
}

/** Keep `candidate` within `cap` meters of `anchor` (local ENU). */
export function clampDisplacement(
  origin: LatLon,
  anchor: LatLon,
  candidate: LatLon,
  cap = MAX_LATERAL_CORRECTION_M,
): LatLon {
  const a = toLocalMeters(origin, anchor);
  const c = toLocalMeters(origin, candidate);
  const dx = c.x - a.x;
  const dy = c.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= cap || dist <= 1e-9) return { ...candidate };
  const s = cap / dist;
  return fromLocalMeters(origin, a.x + dx * s, a.y + dy * s);
}

function candidateProjections(
  origin: LatLon,
  point: LatLon,
  centerline: LatLon[],
  lineDist: number[],
  aroundSeg: number | null,
): SegmentProjection[] {
  const nSeg = centerline.length - 1;
  const candidates: SegmentProjection[] = [];
  const pushUnique = (proj: SegmentProjection) => {
    if (proj.distance > MAX_EMIT_LATERAL_M) return;
    if (
      candidates.some(
        (c) =>
          c.segmentIndex === proj.segmentIndex &&
          Math.abs(c.t - proj.t) < 0.05,
      )
    ) {
      return;
    }
    candidates.push(proj);
  };

  if (aroundSeg != null) {
    const start = Math.max(0, aroundSeg - 12);
    const end = Math.min(nSeg - 1, aroundSeg + 48);
    for (let i = start; i <= end; i += 1) {
      pushUnique(
        projectOntoSegment(
          origin,
          point,
          centerline[i],
          centerline[i + 1],
          lineDist[i],
          i,
        ),
      );
    }
  }

  // Sparse global scan so parallel sections remain reachable.
  const step = Math.max(1, Math.floor(nSeg / CANDIDATES_PER_SAMPLE));
  for (let i = 0; i < nSeg; i += step) {
    pushUnique(
      projectOntoSegment(
        origin,
        point,
        centerline[i],
        centerline[i + 1],
        lineDist[i],
        i,
      ),
    );
  }
  // Always consider absolute nearest if list is empty / weak.
  if (candidates.length < 2) {
    let best: SegmentProjection | null = null;
    for (let i = 0; i < nSeg; i += 1) {
      const proj = projectOntoSegment(
        origin,
        point,
        centerline[i],
        centerline[i + 1],
        lineDist[i],
        i,
      );
      if (!best || proj.distance < best.distance) best = proj;
    }
    if (best) pushUnique(best);
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.slice(0, TOP_K);
}

/**
 * Continuity-constrained map match via Viterbi over centerline segments.
 * Emission ∝ lateral distance; transition penalizes large Δs jumps / reverse.
 */
export function snapToCenterline(
  points: TelemetryPoint[],
  centerline: LatLon[],
): MatchedPoint[] {
  if (centerline.length < 2 || !points.length) return [];

  const origin = centerline[0];
  const lineDist = cumulativePathMeters(centerline);
  const total = lineDist[lineDist.length - 1] || 1;

  type Node = { proj: SegmentProjection; cost: number; prev: number };
  const layers: Node[][] = [];
  let prevSeg: number | null = null;

  for (let pi = 0; pi < points.length; pi += 1) {
    const point = points[pi];
    if (point.lat == null || point.lon == null) {
      layers.push([]);
      continue;
    }
    const cands = candidateProjections(
      origin,
      { lat: point.lat, lon: point.lon },
      centerline,
      lineDist,
      prevSeg,
    );
    if (!cands.length) {
      layers.push([]);
      continue;
    }

    const dt =
      pi > 0 && Number.isFinite(points[pi].t) && Number.isFinite(points[pi - 1]?.t)
        ? Math.max(0.02, points[pi].t - points[pi - 1].t)
        : 0.1;
    const speedMs = ((point.speed || 0) * 1000) / 3600;
    const expectedStep = Math.max(0.5, speedMs * dt);

    const layer: Node[] = cands.map((proj) => {
      const emit = (proj.distance / MAX_EMIT_LATERAL_M) ** 2;
      if (!layers.length || !layers[layers.length - 1].length) {
        return { proj, cost: emit, prev: -1 };
      }
      const prevLayer = layers[layers.length - 1];
      let bestCost = Number.POSITIVE_INFINITY;
      let bestPrev = 0;
      for (let j = 0; j < prevLayer.length; j += 1) {
        const prev = prevLayer[j];
        const ds = proj.distAlong - prev.proj.distAlong;
        // Strongly penalize reverse / giant jumps (parallel/hairpin traps).
        let transition = 0;
        if (ds < -2) {
          transition += 12 + Math.abs(ds) * 0.6;
        } else {
          transition += Math.abs(ds - expectedStep) / Math.max(6, expectedStep);
          // Shortcuts across hairpins/parallel sections: huge +Δs vs speed.
          const maxStep = expectedStep * 3.5 + 12;
          if (ds > maxStep) transition += ((ds - maxStep) / 8) ** 2;
        }
        // Matched display continuity: reject teleport between nearby asphalt.
        const hop = haversineMeters(
          prev.proj.snapped.lat,
          prev.proj.snapped.lon,
          proj.snapped.lat,
          proj.snapped.lon,
        );
        const maxHop = Math.max(18, speedMs * dt * 2.8 + 10);
        if (hop > maxHop) transition += ((hop - maxHop) / 10) ** 2;
        // Prefer advancing segment index gently.
        const segJump = proj.segmentIndex - prev.proj.segmentIndex;
        if (segJump < -2) transition += -segJump * 1.5;
        if (segJump > 40) transition += (segJump - 40) * 0.08;
        const cost = prev.cost + emit + transition;
        if (cost < bestCost) {
          bestCost = cost;
          bestPrev = j;
        }
      }
      return { proj, cost: bestCost, prev: bestPrev };
    });
    layers.push(layer);
    const bestNode = layer.reduce((a, b) => (a.cost <= b.cost ? a : b));
    prevSeg = bestNode.proj.segmentIndex;
  }

  // Backtrack.
  const chosen: Array<SegmentProjection | null> = new Array(points.length).fill(
    null,
  );
  let idx = -1;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    if (!layers[i].length) continue;
    if (idx < 0) {
      let best = 0;
      for (let j = 1; j < layers[i].length; j += 1) {
        if (layers[i][j].cost < layers[i][best].cost) best = j;
      }
      idx = best;
    }
    chosen[i] = layers[i][idx].proj;
    idx = layers[i][idx].prev;
    if (idx < 0 && i > 0) {
      // Restart if broken chain.
      idx = -1;
    }
  }

  return points.map((point, i) => {
    const best = chosen[i];
    if (!best || point.lat == null || point.lon == null) {
      return {
        ...point,
        trackDist: best?.distAlong ?? 0,
        lateralOffset: 0,
        rawLat: point.lat,
        rawLon: point.lon,
      };
    }
    const raw = { lat: point.lat, lon: point.lon };
    // Preserve racing line. Only gently pull true spikes toward the matched segment.
    const display =
      best.distance > SPIKE_LATERAL_M
        ? lightCorrectTowardCenterline(
            origin,
            raw,
            best.snapped,
            Math.min(MAX_LATERAL_CORRECTION_M * 3, best.distance * 0.35),
          )
        : raw;
    return {
      ...point,
      lat: display.lat,
      lon: display.lon,
      trackDist: Math.min(total, Math.max(0, best.distAlong)),
      lateralOffset: best.lateral,
      rawLat: point.lat,
      rawLon: point.lon,
    };
  });
}

/** Local curvature proxy from centerline heading change near trackDist. */
function curvatureNear(
  centerline: LatLon[],
  lineDist: number[],
  trackDist: number,
): number {
  const total = lineDist[lineDist.length - 1] || 1;
  const s = Math.min(total, Math.max(0, trackDist));
  let hi = 1;
  while (hi < lineDist.length && lineDist[hi] < s) hi += 1;
  const i = Math.max(1, Math.min(centerline.length - 2, hi));
  const a = centerline[i - 1];
  const b = centerline[i];
  const c = centerline[i + 1];
  const bearing = (p: LatLon, q: LatLon) => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const φ1 = toRad(p.lat);
    const φ2 = toRad(q.lat);
    const Δλ = toRad(q.lon - p.lon);
    return Math.atan2(
      Math.sin(Δλ) * Math.cos(φ2),
      Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ),
    );
  };
  let d = bearing(b, c) - bearing(a, b);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const ds = Math.max(
    1,
    (lineDist[i + 1] ?? lineDist[i]) - (lineDist[i - 1] ?? 0),
  );
  return Math.abs(d) / ds;
}

/**
 * Curvature-adaptive light smoothing of speed, along-track progress, and the
 * raw GPS path. Never projects onto the centerline — that would shave apexes
 * and collapse the racing line. Each display point stays within
 * MAX_LATERAL_CORRECTION_M of its raw sample.
 */
export function smoothMatched(
  points: MatchedPoint[],
  centerline: LatLon[],
  options?: { window?: number },
): MatchedPoint[] {
  if (points.length < 5 || centerline.length < 2) return points;

  const baseWindow = options?.window ?? (points.length > 200 ? 7 : 5);
  const lineDist = cumulativePathMeters(centerline);
  const total = lineDist[lineDist.length - 1] || 1;
  const origin = centerline[0];

  const rawSpeeds = points.map((p) => p.speed);
  const rawDists = points.map((p) => p.trackDist);
  const rawLats = points.map((p) => p.lat ?? p.rawLat ?? 0);
  const rawLons = points.map((p) => p.lon ?? p.rawLon ?? 0);

  const speedsSoft = savitzkyGolay(rawSpeeds, baseWindow);
  const distsSoft = savitzkyGolay(rawDists, baseWindow);
  const latsSoft = savitzkyGolay(rawLats, baseWindow);
  const lonsSoft = savitzkyGolay(rawLons, baseWindow);

  const trackDists = distsSoft.slice();
  for (let i = 1; i < trackDists.length; i += 1) {
    if (trackDists[i] < trackDists[i - 1]) {
      trackDists[i] = trackDists[i - 1];
    }
  }

  return points.map((point, index) => {
    const trackDist = Math.min(total, Math.max(0, trackDists[index]));
    const kappa = curvatureNear(centerline, lineDist, trackDist);
    // High curvature → trust raw more (avoid apex shaving / hairpin shortcuts).
    const blend = Math.min(1, kappa * 100);
    const mixedDist = trackDist * (1 - blend) + rawDists[index] * blend;
    const finalDist = Math.min(
      total,
      Math.max(index > 0 ? trackDists[index - 1] ?? 0 : 0, mixedDist),
    );
    trackDists[index] = finalDist;

    const rawLat = point.rawLat ?? point.lat ?? rawLats[index];
    const rawLon = point.rawLon ?? point.lon ?? rawLons[index];
    const soft = { lat: latsSoft[index], lon: lonsSoft[index] };
    const raw = { lat: rawLat, lon: rawLon };
    // Blend soft→raw in corners, then clamp displacement from raw.
    const mixed = {
      lat: soft.lat * (1 - blend) + raw.lat * blend,
      lon: soft.lon * (1 - blend) + raw.lon * blend,
    };
    const display = clampDisplacement(
      origin,
      raw,
      mixed,
      MAX_LATERAL_CORRECTION_M,
    );

    return {
      ...point,
      speed: Math.max(
        0,
        speedsSoft[index] * (1 - blend * 0.5) + rawSpeeds[index] * (blend * 0.5),
      ),
      trackDist: finalDist,
      lat: display.lat,
      lon: display.lon,
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
  mode: GpsDisplayMode = "snapped",
): TelemetryPoint[] {
  if (mode === "raw" || !matched) return raw;
  return matched;
}
