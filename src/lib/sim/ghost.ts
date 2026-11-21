/**
 * Apex Sim ghosts.
 *
 * The "real" ghost is a lap someone actually drove here, replayed from the
 * uploaded GPS telemetry at its true speed and on its true line: no scaling in
 * distance or time. The "best" ghost is the player's own fastest valid lap.
 */
import westLap from "../rush/data/ghost-thunderhill-west.json";
import { projectOnTrack, type SimTrack, type TrackHit } from "./track";

export type RealLap = {
  trackId: string;
  label: string;
  timeMs: number;
  /** [east m, north m, ms] from the start line. */
  samples: number[][];
};

export type Ghost = {
  kind: "real" | "best";
  label: string;
  lapMs: number;
  n: number;
  t: Float32Array;
  x: Float32Array;
  y: Float32Array;
  /** Arc length along the track at each sample. */
  s: Float32Array;
  heading: Float32Array;
  /** Speed (m/s) at each sample, averaged over neighbours to calm GPS noise. */
  speed: Float32Array;
  /** Ghost time (ms) as it passes each track sample, for the live delta. */
  timeAtIndex: Float32Array;
};

export type GhostPose = { x: number; y: number; z: number; heading: number; speed: number };

const BUNDLED: Record<string, RealLap> = { "thunderhill-west": westLap as RealLap };

export function bundledRealLap(trackId: string): RealLap | null {
  return BUNDLED[trackId] ?? null;
}

function build(kind: Ghost["kind"], label: string, track: SimTrack, flat: ArrayLike<number>): Ghost | null {
  const n = Math.floor(flat.length / 3);
  if (n < 8) return null;
  const t = new Float32Array(n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const s = new Float32Array(n);
  const heading = new Float32Array(n);
  const speed = new Float32Array(n);
  const hit: TrackHit = { i: 0, s: 0, d: 0 };
  for (let i = 0; i < n; i += 1) {
    x[i] = flat[i * 3]!;
    y[i] = flat[i * 3 + 1]!;
    t[i] = flat[i * 3 + 2]!;
    projectOnTrack(track, x[i]!, y[i]!, hit, i === 0);
    s[i] = hit.s;
  }
  // The lap runs from the line to the line: unwrap s so it only grows.
  let turns = 0;
  for (let i = 1; i < n; i += 1) {
    let v = s[i]! + turns * track.length;
    if (v < s[i - 1]! - track.length / 2) {
      turns += 1;
      v += track.length;
    } else if (v < s[i - 1]!) v = s[i - 1]!;
    s[i] = v;
  }
  if (s[0]! > track.length / 2) for (let i = 0; i < n; i += 1) s[i] = s[i]! - track.length;
  for (let i = 0; i < n; i += 1) {
    const a = Math.max(0, i - 2);
    const b = Math.min(n - 1, i + 2);
    heading[i] = Math.atan2(y[b]! - y[a]!, x[b]! - x[a]!);
    const p = Math.max(0, i - 3);
    const q = Math.min(n - 1, i + 3);
    let dist = 0;
    for (let k = p; k < q; k += 1) dist += Math.hypot(x[k + 1]! - x[k]!, y[k + 1]! - y[k]!);
    speed[i] = t[q]! > t[p]! ? (dist / (t[q]! - t[p]!)) * 1000 : 0;
  }
  const lapMs = t[n - 1]!;
  const timeAtIndex = new Float32Array(track.n);
  let k = 0;
  for (let i = 0; i < track.n; i += 1) {
    const at = i * track.spacing;
    while (k < n - 2 && s[k + 1]! < at) k += 1;
    const span = s[k + 1]! - s[k]!;
    const f = span > 1e-6 ? Math.max(0, Math.min(1, (at - s[k]!) / span)) : 0;
    timeAtIndex[i] = t[k]! + (t[k + 1]! - t[k]!) * f;
  }
  return { kind, label, lapMs, n, t, x, y, s, heading, speed, timeAtIndex };
}

export function ghostFromRealLap(track: SimTrack, lap: RealLap): Ghost | null {
  const flat: number[] = [];
  for (const row of lap.samples) flat.push(row[0]!, row[1]!, row[2]!);
  return build("real", lap.label, track, flat);
}

/** `rec` is flat [x, y, ms, …] from the session recorder. */
export function ghostFromRecording(track: SimTrack, rec: ArrayLike<number>, label: string): Ghost | null {
  return build("best", label, track, rec);
}

/** Where the ghost is `ms` into its lap; false once it has finished. */
export function ghostPose(ghost: Ghost, track: SimTrack, ms: number, cursor: { k: number }, out: GhostPose): boolean {
  if (ms < 0 || ms > ghost.lapMs) return false;
  let k = cursor.k;
  if (k >= ghost.n - 1 || ghost.t[k]! > ms) k = 0;
  while (k < ghost.n - 2 && ghost.t[k + 1]! < ms) k += 1;
  cursor.k = k;
  const span = ghost.t[k + 1]! - ghost.t[k]!;
  const f = span > 0 ? (ms - ghost.t[k]!) / span : 0;
  out.x = ghost.x[k]! + (ghost.x[k + 1]! - ghost.x[k]!) * f;
  out.y = ghost.y[k]! + (ghost.y[k + 1]! - ghost.y[k]!) * f;
  let dh = ghost.heading[k + 1]! - ghost.heading[k]!;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  out.heading = ghost.heading[k]! + dh * f;
  const at = ghost.s[k]! + (ghost.s[k + 1]! - ghost.s[k]!) * f;
  const fi = (((at / track.spacing) % track.n) + track.n) % track.n;
  const i = Math.floor(fi);
  out.z = track.pz[i]! * (1 - (fi - i)) + track.pz[(i + 1) % track.n]! * (fi - i);
  out.speed = ghost.speed[k]! + (ghost.speed[k + 1]! - ghost.speed[k]!) * f;
  return true;
}

/** Seconds the player is behind (+) or ahead (−) of the ghost right here. */
export function ghostDelta(ghost: Ghost, trackIndex: number, lapMs: number): number {
  return (lapMs - ghost.timeAtIndex[trackIndex]!) / 1000;
}

const KEY = "apex-sim-best-v1";
export type SavedBest = { lapMs: number; rec: number[] };

export function loadBest(trackId: string, carName: string): SavedBest | null {
  try {
    const raw = localStorage.getItem(`${KEY}:${trackId}:${carName}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedBest;
    if (typeof v.lapMs !== "number" || !Array.isArray(v.rec) || v.rec.length < 24) return null;
    return v;
  } catch {
    return null;
  }
}

export function saveBest(trackId: string, carName: string, lapMs: number, rec: number[]): void {
  try {
    const rounded = rec.map((v) => Math.round(v * 100) / 100);
    localStorage.setItem(`${KEY}:${trackId}:${carName}`, JSON.stringify({ lapMs, rec: rounded }));
  } catch {
    // Storage full or blocked: the ghost just does not persist.
  }
}
