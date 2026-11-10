import { wrapAngle } from "./math";
import {
  latLonToLocal,
  poseAt,
  projectOnTrack,
  createTrackHit,
  type Kart2Track,
} from "./track";

export type GeoSample = {
  t: number;
  lat: number;
  lon: number;
  alt?: number;
};

export type GhostLap = {
  name: string;
  /** Seconds for one loop of the recording. */
  duration: number;
  dt: number;
  count: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  heading: Float32Array;
  /** Unwrapped arc length at each sample (m). */
  s: Float32Array;
};

export type GhostPose = {
  x: number;
  y: number;
  z: number;
  heading: number;
  s: number;
  active: boolean;
};

const GHOST_DT = 0.05;

export function emptyGhostPose(): GhostPose {
  return { x: 0, y: 0, z: 0, heading: 0, s: 0, active: false };
}

/** A beatable reference lap that rides the centreline. */
export function referenceGhost(track: Kart2Track): GhostLap {
  const pace = 16.5;
  const duration = track.length / pace;
  const count = Math.max(8, Math.ceil(duration / GHOST_DT));
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const heading = new Float32Array(count);
  const s = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const along = (i / count) * track.length;
    const pose = poseAt(track, along, 0);
    x[i] = pose.x;
    y[i] = pose.y;
    z[i] = pose.z;
    heading[i] = pose.heading;
    s[i] = along;
  }
  return { name: "Reference lap", duration, dt: duration / count, count, x, y, z, heading, s };
}

/**
 * Project a telemetry lap into the track's scaled frame.
 * Returns null when the lap isn't on this circuit (median offset too large).
 */
export function ghostFromSamples(
  track: Kart2Track,
  samples: GeoSample[],
  name: string,
): GhostLap | null {
  const pts = samples
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .slice()
    .sort((a, b) => a.t - b.t);
  if (pts.length < 4) return null;
  const hit = createTrackHit();
  const local: Array<{ t: number; x: number; y: number; d: number }> = [];
  for (const p of pts) {
    const xy = latLonToLocal(track.lat0, track.lon0, p.lat, p.lon, track.scale);
    projectOnTrack(track, xy.x, xy.y, hit);
    local.push({ t: p.t, x: xy.x, y: xy.y, d: hit.d });
  }
  const offsets = local.map((p) => Math.abs(p.d)).sort((a, b) => a - b);
  const median = offsets[Math.floor(offsets.length / 2)] ?? Infinity;
  if (median > 40) return null;

  const t0 = local[0]!.t;
  const t1 = local[local.length - 1]!.t;
  const duration = Math.max(GHOST_DT * 4, t1 - t0);
  const count = Math.max(8, Math.ceil(duration / GHOST_DT));
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const heading = new Float32Array(count);
  const s = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = t0 + (i / (count - 1)) * duration;
    let j = 0;
    while (j < local.length - 2 && local[j + 1]!.t < t) j += 1;
    const a = local[j]!;
    const b = local[Math.min(local.length - 1, j + 1)]!;
    const u = b.t === a.t ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    x[i] = a.x + (b.x - a.x) * u;
    y[i] = a.y + (b.y - a.y) * u;
    projectOnTrack(track, x[i]!, y[i]!, hit);
    z[i] = hit.z;
    s[i] = hit.s;
  }
  // Unwrap arc length so a lap that crosses the line stays monotonic.
  let acc = s[0]!;
  let prev = s[0]!;
  s[0] = acc;
  for (let i = 1; i < count; i += 1) {
    let ds = s[i]! - prev;
    if (ds > track.length * 0.5) ds -= track.length;
    if (ds < -track.length * 0.5) ds += track.length;
    acc += ds;
    prev = s[i]!;
    s[i] = acc;
  }
  for (let i = 0; i < count; i += 1) {
    const n = Math.min(count - 1, i + 1);
    const p = Math.max(0, i - 1);
    heading[i] = Math.atan2(x[n]! - x[p]!, y[n]! - y[p]!);
  }
  return {
    name,
    duration,
    dt: duration / (count - 1),
    count,
    x,
    y,
    z,
    heading,
    s,
  };
}

export function sampleGhost(ghost: GhostLap, time: number, out: GhostPose) {
  if (ghost.count < 2 || ghost.duration <= 0) {
    out.active = false;
    return;
  }
  let t = time % ghost.duration;
  if (t < 0) t += ghost.duration;
  const f = t / ghost.dt;
  const i = Math.max(0, Math.min(ghost.count - 2, Math.floor(f)));
  const u = Math.max(0, Math.min(1, f - i));
  out.x = ghost.x[i]! * (1 - u) + ghost.x[i + 1]! * u;
  out.y = ghost.y[i]! * (1 - u) + ghost.y[i + 1]! * u;
  out.z = ghost.z[i]! * (1 - u) + ghost.z[i + 1]! * u;
  out.heading = wrapAngle(
    ghost.heading[i]! + wrapAngle(ghost.heading[i + 1]! - ghost.heading[i]!) * u,
  );
  out.s = ghost.s[i]! * (1 - u) + ghost.s[i + 1]! * u;
  out.active = true;
}
