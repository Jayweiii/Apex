/**
 * Apex Rush track geometry.
 *
 * A real circuit outline (metres east/north of the start line, with real
 * height) is shrunk to kart scale, smoothed so corners are drivable at the
 * kart's width, and resampled to even spacing with tangents, curvature and
 * grade. Everything the sim reads per tick is in typed arrays.
 */

export type RushTrackData = {
  id: string;
  name: string;
  location: string;
  origin: { lat: number; lon: number };
  lengthM: number;
  /** Closed centreline, driving order: [east m, north m, height m]. */
  pts: number[][];
  /** Real terrain heights around the track (same datum as pts), or null. */
  grid: { x0: number; y0: number; x1: number; y1: number; nx: number; ny: number; z: number[] } | null;
  sources?: string[];
};

export type RushPad = { s: number; d: number; x: number; y: number; z: number; heading: number };
export type RushBox = { x: number; y: number; z: number };

export type RushTrack = {
  data: RushTrackData;
  /** Real metres → game metres. */
  scale: number;
  /** Height multiplier on top of `scale` (hills are exaggerated). */
  vert: number;
  n: number;
  spacing: number;
  length: number;
  halfWidth: number;
  /** Grass run-off beyond the asphalt before the wall. */
  runoff: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** Unit tangent (driving direction). */
  tx: Float32Array;
  ty: Float32Array;
  /** Signed curvature (1/m, + = left turn). */
  curv: Float32Array;
  /** dz/ds. */
  grade: Float32Array;
  gates: number;
  pads: RushPad[];
  boxes: RushBox[];
  /** Laps for a race on this track. */
  laps: number;
  /** Highest point above the lowest (game metres). */
  relief: number;
  /** Real height (m, data datum) that maps to game height 0. */
  zBase: number;
};

export type TrackHit = { i: number; s: number; d: number };

export const HALF_WIDTH = 6.5;
export const RUNOFF = 5.5;
const SPACING = 2;
const TARGET_LENGTH = 1250;
const MAX_GRADE = 0.13;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function resampleClosed(pts: number[][], spacing: number): number[][] {
  const n = pts.length;
  const cum = [0];
  for (let i = 1; i <= n; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i % n]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
  }
  const total = cum[n]!;
  const count = Math.max(32, Math.round(total / spacing));
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

function chaikin(pts: number[][]): number[][] {
  const out: number[][] = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    out.push([0.75 * a[0]! + 0.25 * b[0]!, 0.75 * a[1]! + 0.25 * b[1]!, 0.75 * a[2]! + 0.25 * b[2]!]);
    out.push([0.25 * a[0]! + 0.75 * b[0]!, 0.25 * a[1]! + 0.75 * b[1]!, 0.25 * a[2]! + 0.75 * b[2]!]);
  }
  return out;
}

/** Signed curvature at each point from the turn across ±k samples. */
function curvatureOf(pts: number[][], k: number): Float32Array {
  const n = pts.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = pts[(i - k + n) % n]!;
    const b = pts[i]!;
    const c = pts[(i + k) % n]!;
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const vx = c[0]! - b[0]!;
    const vy = c[1]! - b[1]!;
    const cross = ux * vy - uy * vx;
    const dot = ux * vx + uy * vy;
    const ang = Math.atan2(cross, dot);
    const len = (Math.hypot(ux, uy) + Math.hypot(vx, vy)) / 2 || 1;
    out[i] = ang / len;
  }
  return out;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function rushRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function trackSeed(track: RushTrack): number {
  return hashSeed(track.data.id);
}

export function buildRushTrack(data: RushTrackData): RushTrack {
  if (data.pts.length < 8) throw new Error("Track outline is too short");
  const scale = clamp(TARGET_LENGTH / Math.max(1, data.lengthM), 0.45, 0.62);
  let vert = 2.4;

  // Drop a duplicated closing point, then scale to game metres (height later).
  let raw = data.pts.map((p) => [p[0]! * scale, p[1]! * scale, p[2] ?? 0]);
  const first = raw[0]!;
  const last = raw[raw.length - 1]!;
  if (Math.hypot(first[0]! - last[0]!, first[1]! - last[1]!) < 1) raw = raw.slice(0, -1);

  let pts = resampleClosed(chaikin(chaikin(resampleClosed(raw, 6))), SPACING);

  // Open up corners tighter than the kart can use at this width: smooth only
  // around the offending samples until the inner edge no longer folds over.
  const minRadius = HALF_WIDTH + 4;
  for (let iter = 0; iter < 80; iter += 1) {
    const k = curvatureOf(pts, 3);
    const n = pts.length;
    const flag = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(k[i]!) > 1 / minRadius) {
        any = true;
        for (let o = -8; o <= 8; o += 1) flag[(i + o + n) % n] = 1;
      }
    }
    if (!any) break;
    const next = pts.map((p) => p.slice());
    for (let i = 0; i < n; i += 1) {
      if (!flag[i]) continue;
      const a = pts[(i - 1 + n) % n]!;
      const c = pts[(i + 1) % n]!;
      const b = pts[i]!;
      next[i]![0] = b[0]! * 0.5 + (a[0]! + c[0]!) * 0.25;
      next[i]![1] = b[1]! * 0.5 + (a[1]! + c[1]!) * 0.25;
    }
    pts = iter % 8 === 7 ? resampleClosed(next, SPACING) : next;
  }
  pts = resampleClosed(pts, SPACING);
  const n = pts.length;

  // Height: smooth, then cap the steepest grade by easing the exaggeration.
  let zs = pts.map((p) => p[2]!);
  for (let pass = 0; pass < 3; pass += 1) {
    const next = zs.slice();
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let o = -6; o <= 6; o += 1) sum += zs[(i + o + n) % n]!;
      next[i] = sum / 13;
    }
    zs = next;
  }
  const zMin = Math.min(...zs);
  zs = zs.map((z) => z - zMin);
  let maxGrade = 0;
  for (let i = 0; i < n; i += 1) {
    const g = Math.abs(zs[(i + 3) % n]! - zs[(i - 3 + n) % n]!) / (6 * SPACING);
    if (g > maxGrade) maxGrade = g;
  }
  const realGrade = maxGrade * scale;
  if (realGrade * vert > MAX_GRADE) vert = Math.max(1, MAX_GRADE / realGrade);

  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const pz = new Float32Array(n);
  const tx = new Float32Array(n);
  const ty = new Float32Array(n);
  const grade = new Float32Array(n);
  let length = 0;
  for (let i = 0; i < n; i += 1) {
    px[i] = pts[i]![0]!;
    py[i] = pts[i]![1]!;
    pz[i] = zs[i]! * scale * vert;
  }
  for (let i = 0; i < n; i += 1) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = px[b]! - px[a]!;
    const dy = py[b]! - py[a]!;
    const len = Math.hypot(dx, dy) || 1;
    tx[i] = dx / len;
    ty[i] = dy / len;
    grade[i] = (pz[(i + 3) % n]! - pz[(i - 3 + n) % n]!) / (6 * SPACING);
    length += Math.hypot(px[b]! - px[i]!, py[b]! - py[i]!);
  }
  const curv = curvatureOf(pts, 3);
  const spacing = length / n;

  const track: RushTrack = {
    data,
    scale,
    vert,
    n,
    spacing,
    length,
    halfWidth: HALF_WIDTH,
    runoff: RUNOFF,
    px,
    py,
    pz,
    tx,
    ty,
    curv,
    grade,
    gates: 8,
    pads: [],
    boxes: [],
    laps: length > 1700 ? 2 : 3,
    relief: Math.max(...pz),
    zBase: zMin,
  };

  // Boost pads on the longest straights; item boxes spread round the lap.
  const straights: Array<{ start: number; len: number }> = [];
  let run = 0;
  for (let i = 0; i < n * 2; i += 1) {
    if (Math.abs(curv[i % n]!) < 0.006) run += 1;
    else {
      if (run * spacing > 50 && i - run < n) straights.push({ start: (i - run) % n, len: run });
      run = 0;
    }
  }
  straights.sort((a, b) => b.len - a.len);
  const startClear = 30 / spacing;
  let side = 1;
  for (const st of straights.slice(0, 3)) {
    const i = Math.round(st.start + st.len * 0.4) % n;
    if (i < startClear || i > n - startClear) continue;
    const d = side * 2.6;
    side = -side;
    track.pads.push({
      s: i * spacing,
      d,
      x: px[i]! - ty[i]! * d,
      y: py[i]! + tx[i]! * d,
      z: pz[i]!,
      heading: Math.atan2(ty[i]!, tx[i]!),
    });
  }
  for (const frac of [0.12, 0.37, 0.62, 0.87]) {
    const i = Math.floor(frac * n) % n;
    for (const lane of [-3.6, 0, 3.6]) {
      track.boxes.push({ x: px[i]! - ty[i]! * lane, y: py[i]! + tx[i]! * lane, z: pz[i]! });
    }
  }
  return track;
}

/**
 * Closest point on the centreline, searching around `hit.i` (karts move far
 * less than the window per tick). `full` searches the whole lap. Writes into
 * `hit`: index, arc length and signed lateral offset (+ = left).
 */
export function projectOnTrack(track: RushTrack, x: number, y: number, hit: TrackHit, full = false): TrackHit {
  const n = track.n;
  const win = full ? n >> 1 : 30;
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

/** Height of the road at arc length s. */
export function heightAt(track: RushTrack, s: number): number {
  const f = (((s / track.spacing) % track.n) + track.n) % track.n;
  const i = Math.floor(f);
  const t = f - i;
  return track.pz[i]! * (1 - t) + track.pz[(i + 1) % track.n]! * t;
}

/** World pose on the track at arc length s and lateral offset d. */
export function poseAt(track: RushTrack, s: number, d = 0): { x: number; y: number; z: number; heading: number; i: number } {
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

/** Real terrain height (game metres) from the baked grid, or null without one. */
export function gridHeight(track: RushTrack, x: number, y: number): number | null {
  const g = track.data.grid;
  if (!g) return null;
  const rx = x / track.scale;
  const ry = y / track.scale;
  const fx = clamp(((rx - g.x0) / (g.x1 - g.x0)) * (g.nx - 1), 0, g.nx - 1.001);
  const fy = clamp(((ry - g.y0) / (g.y1 - g.y0)) * (g.ny - 1), 0, g.ny - 1.001);
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const at = (i: number, j: number) => g.z[j * g.nx + i]!;
  const h =
    at(ix, iy) * (1 - tx) * (1 - ty) + at(ix + 1, iy) * tx * (1 - ty) + at(ix, iy + 1) * (1 - tx) * ty + at(ix + 1, iy + 1) * tx * ty;
  return (h - track.zBase) * track.scale * track.vert;
}
