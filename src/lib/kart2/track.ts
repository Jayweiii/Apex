import { clamp } from "./math";

export type Kart2Level = {
  id: string;
  name: string;
  short: string;
  basedOn: string;
  blurb: string;
  /** Horizontal scale applied to real-world metres. */
  scale: number;
  /** Asphalt half-width after scaling (m). */
  halfWidth: number;
  latLon: ReadonlyArray<readonly [number, number]>;
  /** Metres above sea level, one per lat/lon sample, when known. */
  altM: ReadonlyArray<number> | null;
  /** Extra vertical scale so hills read at kart size. */
  vertExaggeration: number;
  /** True when `altM` is a surveyed DEM rather than a shaped relief. */
  surveyedElevation: boolean;
};

export type TrackHit = {
  index: number;
  /** 0..1 along the segment starting at `index`. */
  t: number;
  /** Arc length of the closest point (m). */
  s: number;
  /** Signed lateral offset (m, + = left of travel). */
  d: number;
  z: number;
  grade: number;
};

export type Kart2Track = {
  level: Kart2Level;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  s: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  /** Signed curvature (cross of neighbouring tangents). */
  curv: Float64Array;
  /** Slope along the centreline, + = uphill in the direction of travel. */
  grade: Float64Array;
  count: number;
  length: number;
  halfWidth: number;
  /** Origin used to project telemetry into this frame. */
  lat0: number;
  lon0: number;
  scale: number;
};

const SPACING_M = 3;

export function createTrackHit(): TrackHit {
  return { index: 0, t: 0, s: 0, d: 0, z: 0, grade: 0 };
}

export function latLonToLocal(
  lat0: number,
  lon0: number,
  lat: number,
  lon: number,
  scale: number,
): { x: number; y: number } {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    x: (lon - lon0) * mPerDegLon * scale,
    y: (lat - lat0) * mPerDegLat * scale,
  };
}

/** Build a closed, smoothed kart circuit. Allocates; call once per track. */
export function buildTrack(level: Kart2Level): Kart2Track {
  const lat0 = level.latLon[0]![0];
  const lon0 = level.latLon[0]![1];
  const alt =
    level.altM && level.altM.length === level.latLon.length ? level.altM : null;
  const altMin = alt ? Math.min(...alt) : 0;
  const vScale = level.scale * level.vertExaggeration;
  let pts: Array<[number, number, number]> = level.latLon.map(([lat, lon], i) => {
    const p = latLonToLocal(lat0, lon0, lat, lon, level.scale);
    const z = alt ? (alt[i]! - altMin) * vScale : reliefAt(i, level.latLon.length);
    return [p.x, p.y, z];
  });
  // Drop a duplicated closing sample.
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (pts.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1.5) {
    pts = pts.slice(0, -1);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next: Array<[number, number, number]> = [];
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      next.push([
        0.75 * a[0] + 0.25 * b[0],
        0.75 * a[1] + 0.25 * b[1],
        0.75 * a[2] + 0.25 * b[2],
      ]);
      next.push([
        0.25 * a[0] + 0.75 * b[0],
        0.25 * a[1] + 0.75 * b[1],
        0.25 * a[2] + 0.75 * b[2],
      ]);
    }
    pts = next;
  }

  const cum: number[] = [0];
  for (let i = 1; i <= pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i % pts.length]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[cum.length - 1]!;
  const count = Math.max(24, Math.round(total / SPACING_M));
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  let seg = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * total;
    while (seg < pts.length - 1 && cum[seg + 1]! < target) seg += 1;
    const span = cum[seg + 1]! - cum[seg]! || 1;
    const t = (target - cum[seg]!) / span;
    const a = pts[seg]!;
    const b = pts[(seg + 1) % pts.length]!;
    px[k] = a[0] + (b[0] - a[0]) * t;
    py[k] = a[1] + (b[1] - a[1]) * t;
    pz[k] = a[2] + (b[2] - a[2]) * t;
  }

  const s = new Float64Array(count);
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  const curv = new Float64Array(count);
  let length = 0;
  for (let k = 0; k < count; k += 1) {
    const n = (k + 1) % count;
    const p = (k - 1 + count) % count;
    const dx = px[n]! - px[p]!;
    const dy = py[n]! - py[p]!;
    const len = Math.hypot(dx, dy) || 1;
    tx[k] = dx / len;
    ty[k] = dy / len;
    s[k] = length;
    length += Math.hypot(px[n]! - px[k]!, py[n]! - py[k]!);
  }
  for (let k = 0; k < count; k += 1) {
    const n = (k + 1) % count;
    curv[k] = tx[k]! * ty[n]! - ty[k]! * tx[n]!;
  }
  const grade = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    const n = (k + 3) % count;
    const p = (k - 3 + count) % count;
    const run = Math.hypot(px[n]! - px[p]!, py[n]! - py[p]!) || 1;
    grade[k] = clamp((pz[n]! - pz[p]!) / run, -0.22, 0.22);
  }

  return {
    level,
    px,
    py,
    pz,
    s,
    tx,
    ty,
    curv,
    grade,
    count,
    length,
    halfWidth: level.halfWidth,
    lat0,
    lon0,
    scale: level.scale,
  };
}

/** Shaped relief when a level has no surveyed heights (still drives as a hill). */
function reliefAt(i: number, n: number): number {
  const t = (i / n) * Math.PI * 2;
  return 8 * (Math.sin(t) * 0.65 + Math.sin(t * 2 + 0.7) * 0.35) + 8;
}

/** Closest point on the centreline. Writes into `hit` (no allocation). */
export function projectOnTrack(
  track: Kart2Track,
  x: number,
  y: number,
  hit: TrackHit,
): void {
  const n = track.count;
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    const ax = track.px[i]!;
    const ay = track.py[i]!;
    const ex = track.px[j]! - ax;
    const ey = track.py[j]! - ay;
    const len2 = ex * ex + ey * ey || 1;
    let t = ((x - ax) * ex + (y - ay) * ey) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + ex * t;
    const py = ay + ey * t;
    const d2 = (x - px) * (x - px) + (y - py) * (y - py);
    if (d2 < best) {
      best = d2;
      bestI = i;
      bestT = t;
    }
  }
  const j = (bestI + 1) % n;
  const ax = track.px[bestI]!;
  const ay = track.py[bestI]!;
  const px = ax + (track.px[j]! - ax) * bestT;
  const py = ay + (track.py[j]! - ay) * bestT;
  const tx = track.tx[bestI]!;
  const ty = track.ty[bestI]!;
  const seg = Math.hypot(track.px[j]! - ax, track.py[j]! - ay);
  let s = track.s[bestI]! + seg * bestT;
  if (s >= track.length) s -= track.length;
  hit.index = bestI;
  hit.t = bestT;
  hit.s = s;
  hit.d = (x - px) * -ty + (y - py) * tx;
  hit.z = track.pz[bestI]! + (track.pz[j]! - track.pz[bestI]!) * bestT;
  hit.grade = track.grade[bestI]!;
}

export function poseAt(
  track: Kart2Track,
  s: number,
  lateral = 0,
): { x: number; y: number; z: number; heading: number } {
  const len = track.length;
  let target = s % len;
  if (target < 0) target += len;
  let i = 0;
  while (i < track.count - 1 && track.s[i + 1]! < target) i += 1;
  const j = (i + 1) % track.count;
  const seg = Math.hypot(track.px[j]! - track.px[i]!, track.py[j]! - track.py[i]!) || 1;
  const t = Math.max(0, Math.min(1, (target - track.s[i]!) / seg));
  const tx = track.tx[i]!;
  const ty = track.ty[i]!;
  const cx = track.px[i]! + (track.px[j]! - track.px[i]!) * t;
  const cy = track.py[i]! + (track.py[j]! - track.py[i]!) * t;
  const z = track.pz[i]! + (track.pz[j]! - track.pz[i]!) * t;
  return {
    x: cx + -ty * lateral,
    y: cy + tx * lateral,
    z,
    heading: Math.atan2(tx, ty),
  };
}
