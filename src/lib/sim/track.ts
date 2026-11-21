/**
 * Apex Sim track geometry: the real circuit at 1:1 scale.
 *
 * The outline is a real GPS lap (metres east/north of the start line) with
 * surveyed height. It is splined, resampled to one metre and lightly smoothed
 * to remove GPS jitter; nothing is shrunk and hills are not exaggerated.
 * Width and kerbs are assumed (the source has no edge survey), and the road
 * has no banking.
 */

export type SimTrackData = {
  id: string;
  name: string;
  location: string;
  origin: { lat: number; lon: number };
  lengthM: number;
  /** Closed line, driving order: [east m, north m, height m]. */
  pts: number[][];
  grid: { x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; z: number[] } | null;
  baseAslM?: number;
  sources?: string[];
};

export type SimTrack = {
  data: SimTrackData;
  n: number;
  spacing: number;
  length: number;
  /** Half the asphalt width (m). */
  halfWidth: number;
  /** Kerb strip beyond the asphalt edge (m). */
  kerb: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  /** Signed plan curvature (1/m, + = left). */
  curv: Float32Array;
  /** dz/ds. */
  grade: Float32Array;
  /** d²z/ds² (crests are negative: the car goes light). */
  vcurv: Float32Array;
  /** Lowest road height; heights are stored relative to it. */
  zBase: number;
  relief: number;
};

export type TrackHit = { i: number; s: number; d: number };

export const SIM_HALF_WIDTH = 5.5;
export const SIM_KERB = 1.1;
const SPACING = 1;

/** Closed Catmull-Rom through the points, sampled densely. */
function spline(pts: number[][], per: number): number[][] {
  const n = pts.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    for (let k = 0; k < per; k += 1) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const row: number[] = [];
      for (let c = 0; c < 3; c += 1) {
        row.push(
          0.5 *
            (2 * p1[c]! +
              (-p0[c]! + p2[c]!) * t +
              (2 * p0[c]! - 5 * p1[c]! + 4 * p2[c]! - p3[c]!) * t2 +
              (-p0[c]! + 3 * p1[c]! - 3 * p2[c]! + p3[c]!) * t3),
        );
      }
      out.push(row);
    }
  }
  return out;
}

function resampleClosed(pts: number[][], spacing: number): number[][] {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i % n]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
  }
  const total = cum[n]!;
  const count = Math.round(total / spacing);
  const out: number[][] = [];
  let seg = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * total;
    while (cum[seg + 1]! < target) seg += 1;
    const f = (target - cum[seg]!) / (cum[seg + 1]! - cum[seg]! || 1);
    const a = pts[seg]!;
    const b = pts[(seg + 1) % n]!;
    out.push([a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f]);
  }
  return out;
}

/** Circular moving average of one column over ±k samples, `passes` times. */
function smoothColumn(pts: number[][], col: number, k: number, passes: number): void {
  const n = pts.length;
  const buf = new Float64Array(n);
  for (let p = 0; p < passes; p += 1) {
    let sum = 0;
    for (let o = -k; o <= k; o += 1) sum += pts[(o + n) % n]![col]!;
    for (let i = 0; i < n; i += 1) {
      buf[i] = sum / (2 * k + 1);
      sum += pts[(i + k + 1) % n]![col]! - pts[(i - k + n) % n]![col]!;
    }
    for (let i = 0; i < n; i += 1) pts[i]![col] = buf[i]!;
  }
}

export function buildSimTrack(data: SimTrackData): SimTrack {
  let pts = resampleClosed(spline(data.pts, 12), SPACING);
  smoothColumn(pts, 0, 3, 2);
  smoothColumn(pts, 1, 3, 2);
  smoothColumn(pts, 2, 12, 3);
  pts = resampleClosed(pts, SPACING);
  const n = pts.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    total += Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  }
  const spacing = total / n;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const curv = new Float32Array(n);
  const grade = new Float32Array(n);
  const vcurv = new Float32Array(n);
  let zMin = Infinity;
  let zMax = -Infinity;
  for (const p of pts) {
    zMin = Math.min(zMin, p[2]!);
    zMax = Math.max(zMax, p[2]!);
  }
  for (let i = 0; i < n; i += 1) {
    px[i] = pts[i]![0]!;
    py[i] = pts[i]![1]!;
    pz[i] = pts[i]![2]! - zMin;
  }
  const K = 4;
  for (let i = 0; i < n; i += 1) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = px[b]! - px[a]!;
    const dy = py[b]! - py[a]!;
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    grade[i] = (pz[b]! - pz[a]!) / len;
    const p = (i - K + n) % n;
    const q = (i + K) % n;
    const ux = px[i]! - px[p]!;
    const uy = py[i]! - py[p]!;
    const vx = px[q]! - px[i]!;
    const vy = py[q]! - py[i]!;
    curv[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) / ((Math.hypot(ux, uy) + Math.hypot(vx, vy)) / 2 || 1);
  }
  for (let i = 0; i < n; i += 1) {
    const a = (i - 3 + n) % n;
    const b = (i + 3) % n;
    vcurv[i] = (grade[b]! - grade[a]!) / (6 * spacing);
  }
  return {
    data,
    n,
    spacing,
    length: total,
    halfWidth: SIM_HALF_WIDTH,
    kerb: SIM_KERB,
    px,
    py,
    pz,
    tx,
    ty,
    curv,
    grade,
    vcurv,
    zBase: zMin,
    relief: zMax - zMin,
  };
}

/**
 * Closest centreline point, searching around `hit.i`; `full` searches the
 * whole lap. Writes index, arc length and signed offset (+ = left).
 */
export function projectOnTrack(track: SimTrack, x: number, y: number, hit: TrackHit, full = false): TrackHit {
  const n = track.n;
  const win = full ? n >> 1 : 40;
  let best = hit.i;
  let bestD = Infinity;
  for (let o = -win; o <= win; o += 1) {
    const k = (((hit.i + o) % n) + n) % n;
    const dx = x - track.px[k]!;
    const dy = y - track.py[k]!;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD) {
      bestD = d2;
      best = k;
    }
  }
  const dx = x - track.px[best]!;
  const dy = y - track.py[best]!;
  const along = dx * track.tx[best]! + dy * track.ty[best]!;
  hit.i = best;
  hit.s = (((best * track.spacing + along) % track.length) + track.length) % track.length;
  hit.d = -dx * track.ty[best]! + dy * track.tx[best]!;
  return hit;
}

function lerpArr(track: SimTrack, arr: Float32Array, s: number): number {
  const f = (((s / track.spacing) % track.n) + track.n) % track.n;
  const i = Math.floor(f);
  const t = f - i;
  return arr[i]! * (1 - t) + arr[(i + 1) % track.n]! * t;
}

export function heightAt(track: SimTrack, s: number): number {
  return lerpArr(track, track.pz, s);
}

export type TrackPose = { x: number; y: number; z: number; heading: number; i: number };

export function poseAt(track: SimTrack, s: number, d = 0): TrackPose {
  const f = (((s / track.spacing) % track.n) + track.n) % track.n;
  const i = Math.floor(f);
  const t = f - i;
  const j = (i + 1) % track.n;
  const x = track.px[i]! * (1 - t) + track.px[j]! * t;
  const y = track.py[i]! * (1 - t) + track.py[j]! * t;
  return {
    x: x - track.ty[i]! * d,
    y: y + track.tx[i]! * d,
    z: track.pz[i]! * (1 - t) + track.pz[j]! * t,
    heading: Math.atan2(track.ty[i]!, track.tx[i]!),
    i,
  };
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Surveyed terrain height (road datum), smoothly interpolated; null without a grid. */
export function gridHeight(track: SimTrack, x: number, y: number): number | null {
  const g = track.data.grid;
  if (!g) return null;
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const fx = cl(((x - g.x0) / (g.x1 - g.x0)) * (g.nx - 1), 0, g.nx - 1.001);
  const fy = cl(((y - g.y0) / (g.y1 - g.y0)) * (g.ny - 1), 0, g.ny - 1.001);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const u = fx - ix;
  const v = fy - iy;
  const at = (i: number, j: number) => g.z[cl(j, 0, g.ny - 1) * g.nx + cl(i, 0, g.nx - 1)]!;
  const row = (j: number) => cubic(at(ix - 1, j), at(ix, j), at(ix + 1, j), at(ix + 2, j), u);
  return cubic(row(iy - 1), row(iy), row(iy + 1), row(iy + 2), v) - track.zBase;
}

/** Ground beyond the kerb eases from road height into the surveyed terrain. */
export const VERGE_FLAT = 3;
export const VERGE_BLEND = 40;

/**
 * Ground height at a point whose track projection is `hit`: the road itself,
 * then a verge at road height that blends into the real terrain.
 */
export function groundHeight(track: SimTrack, x: number, y: number, hit: TrackHit): number {
  const road = heightAt(track, hit.s);
  const edge = track.halfWidth + track.kerb + VERGE_FLAT;
  const d = Math.abs(hit.d);
  if (d <= edge) return road;
  const g = gridHeight(track, x, y);
  if (g === null) return road;
  const t = Math.min(1, (d - edge) / VERGE_BLEND);
  return road + (g - road) * t * t * (3 - 2 * t);
}
