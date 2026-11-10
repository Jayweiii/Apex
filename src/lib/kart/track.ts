/**
 * Level geometry: a closed centerline resampled to even spacing, with
 * arc length, tangents and an allocation-free projection for the hot loop.
 */

export type KartLevelDef = {
  id: string;
  name: string;
  /** Real track the layout is loosely based on. */
  basedOn: string;
  /** Closed loop of [lat, lon] (first point not repeated). */
  latLon: ReadonlyArray<readonly [number, number]>;
  /** Shrink the real layout so a lap takes ~40 s in a kart. */
  scale: number;
  /** Half the asphalt width (m). */
  halfWidth: number;
  /** Number of checkpoint gates (gate 0 is the start/finish line). */
  gateCount: number;
  /** Item boxes as fractions of the lap; each places a row of boxes. */
  itemRows: ReadonlyArray<number>;
  /** Ground height (m above sea level) at each latLon point, if known. */
  altM?: ReadonlyArray<number>;
  /** Vertical exaggeration on top of `scale` (hills read better in a kart). */
  vertExaggeration?: number;
};

export type KartTrack = {
  def: KartLevelDef;
  /** Resampled centerline (m). */
  px: Float64Array;
  py: Float64Array;
  /** Cumulative arc length at each point (m). */
  s: Float64Array;
  /** Unit tangent at each point. */
  tx: Float64Array;
  ty: Float64Array;
  count: number;
  length: number;
  halfWidth: number;
  /** Gate arc lengths (gate 0 = start/finish). */
  gates: Float64Array;
  /** Item box world positions. */
  boxX: Float64Array;
  boxY: Float64Array;
  /** Track height at each point (m, lowest point = 0). */
  pz: Float64Array;
  /** Slope along the track at each point (dz/ds, + = uphill forwards). */
  grade: Float64Array;
};

/** Where the car is relative to the track (reused, never reallocated). */
export type TrackHit = {
  index: number;
  /** Arc length of the closest point (m). */
  s: number;
  /** Signed lateral offset from the centerline (m, + = left). */
  d: number;
};

export function createTrackHit(): TrackHit {
  return { index: 0, s: 0, d: 0 };
}

const SPACING_M = 2;

/** Build the playable track from a level definition (allocates; call once). */
export function buildTrack(def: KartLevelDef): KartTrack {
  // 1. lat/lon → local metres (equirectangular around the first point).
  const lat0 = def.latLon[0][0];
  const lon0 = def.latLon[0][1];
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const alt = def.altM && def.altM.length === def.latLon.length ? def.altM : null;
  const altMin = alt ? Math.min(...alt) : 0;
  const vScale = def.scale * (def.vertExaggeration ?? 1);
  let pts: Array<[number, number, number]> = def.latLon.map(([lat, lon], i) => [
    (lon - lon0) * mPerDegLon * def.scale,
    (lat - lat0) * mPerDegLat * def.scale,
    alt ? (alt[i] - altMin) * vScale : 0,
  ]);
  // 2. Chaikin smoothing (closed) for round, kart-friendly corners.
  for (let pass = 0; pass < 3; pass += 1) {
    const next: Array<[number, number, number]> = [];
    for (let i = 0; i < pts.length; i += 1) {
      const [ax, ay, az] = pts[i];
      const [bx, by, bz] = pts[(i + 1) % pts.length];
      next.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.75 * az + 0.25 * bz]);
      next.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by, 0.25 * az + 0.75 * bz]);
    }
    pts = next;
  }
  // 3. Resample at even spacing.
  const cum: number[] = [0];
  for (let i = 1; i <= pts.length; i += 1) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const total = cum[cum.length - 1];
  const count = Math.max(16, Math.round(total / SPACING_M));
  const px = new Float64Array(count);
  const py = new Float64Array(count);
  const pz = new Float64Array(count);
  let seg = 0;
  for (let k = 0; k < count; k += 1) {
    const target = (k / count) * total;
    while (cum[seg + 1] < target) seg += 1;
    const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    const [ax, ay, az] = pts[seg];
    const [bx, by, bz] = pts[(seg + 1) % pts.length];
    px[k] = ax + (bx - ax) * t;
    py[k] = ay + (by - ay) * t;
    pz[k] = az + (bz - az) * t;
  }
  const s = new Float64Array(count);
  const tx = new Float64Array(count);
  const ty = new Float64Array(count);
  let length = 0;
  for (let k = 0; k < count; k += 1) {
    const n = (k + 1) % count;
    const p = (k - 1 + count) % count;
    const dx = px[n] - px[p];
    const dy = py[n] - py[p];
    const len = Math.hypot(dx, dy) || 1;
    tx[k] = dx / len;
    ty[k] = dy / len;
    s[k] = length;
    length += Math.hypot(px[n] - px[k], py[n] - py[k]);
  }
  // Slope from a centred difference over ±3 points (~12 m), so GPS-height
  // noise doesn't make bumps.
  const grade = new Float64Array(count);
  for (let k = 0; k < count; k += 1) {
    const n = (k + 3) % count;
    const p = (k - 3 + count) % count;
    const run = Math.hypot(px[n] - px[p], py[n] - py[p]) || 1;
    grade[k] = (pz[n] - pz[p]) / run;
  }
  const gates = new Float64Array(def.gateCount);
  for (let g = 0; g < def.gateCount; g += 1) gates[g] = (g / def.gateCount) * length;

  // Item boxes: a row of 3 across the track at each listed fraction.
  const boxX: number[] = [];
  const boxY: number[] = [];
  for (const frac of def.itemRows) {
    const k = Math.floor(frac * count) % count;
    for (const lane of [-0.55, 0, 0.55]) {
      boxX.push(px[k] - ty[k] * lane * def.halfWidth);
      boxY.push(py[k] + tx[k] * lane * def.halfWidth);
    }
  }
  return {
    def,
    px,
    py,
    s,
    tx,
    ty,
    count,
    length,
    halfWidth: def.halfWidth,
    pz,
    grade,
    gates,
    boxX: Float64Array.from(boxX),
    boxY: Float64Array.from(boxY),
  };
}

/**
 * Project (x, y) onto the centerline, searching a window around the last
 * index (cars move < 1 point per tick). Full search when `full` is true.
 * Allocation-free; writes into `hit`.
 */
export function projectOnTrack(
  track: KartTrack,
  x: number,
  y: number,
  hit: TrackHit,
  full = false,
): TrackHit {
  const n = track.count;
  let best = hit.index;
  let bestD2 = Infinity;
  const window = full ? n : 24;
  for (let o = -window; o <= window; o += 1) {
    const k = (((hit.index + o) % n) + n) % n;
    const dx = x - track.px[k];
    const dy = y - track.py[k];
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = k;
    }
    if (full && o >= n / 2) break;
  }
  hit.index = best;
  const dx = x - track.px[best];
  const dy = y - track.py[best];
  // Along-track offset refines s between samples; normal = (−ty, tx).
  const along = dx * track.tx[best] + dy * track.ty[best];
  hit.s = (track.s[best] + along + track.length) % track.length;
  hit.d = -dx * track.ty[best] + dy * track.tx[best];
  return hit;
}

/** Point and heading on the centerline at arc length s (for spawning). */
export function poseAt(
  track: KartTrack,
  s: number,
): { x: number; y: number; heading: number; index: number } {
  const t = ((s % track.length) + track.length) % track.length;
  let k = 0;
  while (k < track.count - 1 && track.s[k + 1] <= t) k += 1;
  return {
    x: track.px[k],
    y: track.py[k],
    heading: Math.atan2(track.ty[k], track.tx[k]),
    index: k,
  };
}
