/**
 * Ghost karts.
 *
 * A "real" ghost replays a lap someone actually drove at the circuit: the GPS
 * line from uploaded telemetry, shrunk onto the kart track, with the real
 * lap's speed profile (it slows where the driver braked). Its lap time is
 * scaled to kart pace by one fixed factor for every track, so a faster real
 * lap is a faster ghost. A "best" ghost replays the player's own best lap.
 */
import westGhost from "./data/ghost-thunderhill-west.json";
import { heightAt, projectOnTrack, type RushTrack, type TrackHit } from "./track";

/** Real seconds → game seconds, on top of the track's length scale. */
export const GHOST_PACE = 1.08;

export type RealLap = {
  label: string;
  timeMs: number;
  origin: { lat: number; lon: number };
  /** [east m, north m, ms] relative to `origin`, real scale. */
  samples: number[][];
};

export type Ghost = {
  kind: "real" | "best";
  label: string;
  /** Lap time in the game (ms). */
  lapMs: number;
  /** Real lap time (ms) for "real" ghosts. */
  realMs: number;
  n: number;
  t: Float32Array;
  x: Float32Array;
  y: Float32Array;
  h: Float32Array;
  /** Ghost's time (ms) when it passes each track sample, for the live gap. */
  timeAtIndex: Float32Array;
};

export type GhostPose = { x: number; y: number; z: number; heading: number };

const BUNDLED: Record<string, RealLap> = { "thunderhill-west": westGhost as RealLap };

export function bundledRealLap(trackId: string): RealLap | null {
  return BUNDLED[trackId] ?? null;
}

function finish(kind: Ghost["kind"], label: string, realMs: number, track: RushTrack, t: number[], x: number[], y: number[]): Ghost {
  const n = t.length;
  const h = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    h[i] = Math.atan2(y[b]! - y[a]!, x[b]! - x[a]!);
  }
  const lapMs = t[n - 1]!;
  // Time at each track sample: walk the ghost and fill the samples it passes.
  const timeAtIndex = new Float32Array(track.n).fill(-1);
  const hit: TrackHit = { i: 0, s: 0, d: 0 };
  projectOnTrack(track, x[0]!, y[0]!, hit, true);
  for (let i = 0; i < n; i += 1) {
    projectOnTrack(track, x[i]!, y[i]!, hit);
    if (timeAtIndex[hit.i]! < 0) timeAtIndex[hit.i] = t[i]!;
  }
  // Fill gaps by interpolating round the lap.
  let last = -1;
  for (let i = 0; i < track.n; i += 1) {
    if (timeAtIndex[i]! >= 0) {
      if (last >= 0 && i - last > 1) {
        for (let k = last + 1; k < i; k += 1) timeAtIndex[k] = timeAtIndex[last]! + ((timeAtIndex[i]! - timeAtIndex[last]!) * (k - last)) / (i - last);
      }
      last = i;
    }
  }
  for (let i = 0; i < track.n; i += 1) if (timeAtIndex[i]! < 0) timeAtIndex[i] = i < track.n / 2 ? 0 : lapMs;
  return { kind, label, lapMs, realMs, n, t: Float32Array.from(t), x: Float32Array.from(x), y: Float32Array.from(y), h, timeAtIndex };
}

/** Build a ghost from a real GPS lap. Returns null when it doesn't fit the track. */
export function ghostFromRealLap(track: RushTrack, lap: RealLap): Ghost | null {
  if (lap.samples.length < 20 || lap.timeMs <= 0) return null;
  // Real metres relative to the track's own origin, then to game scale.
  const o = track.data.origin;
  const mLat = 111320;
  const mLon = 111320 * Math.cos((o.lat * Math.PI) / 180);
  const ox = (lap.origin.lon - o.lon) * mLon;
  const oy = (lap.origin.lat - o.lat) * mLat;
  const pts = lap.samples.map((s) => ({ x: (s[0]! + ox) * track.scale, y: (s[1]! + oy) * track.scale, t: s[2]! }));

  // The lap must lie on this track and run the same way round.
  const hit: TrackHit = { i: 0, s: 0, d: 0 };
  projectOnTrack(track, pts[0]!.x, pts[0]!.y, hit, true);
  let off = 0;
  let forward = 0;
  let prevS = hit.s;
  let startIdx = 0;
  let startS = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    projectOnTrack(track, pts[i]!.x, pts[i]!.y, hit);
    if (Math.abs(hit.d) > track.halfWidth + track.runoff) off += 1;
    const ds = hit.s - prevS;
    if (Math.abs(ds) < track.length / 2) forward += ds;
    prevS = hit.s;
    const fromLine = Math.min(hit.s, track.length - hit.s);
    if (fromLine < startS) {
      startS = fromLine;
      startIdx = i;
    }
  }
  if (off > pts.length * 0.15 || forward < track.length * 0.5) return null;

  // Start the replay where the ghost crosses the game's start line.
  const k = lap.timeMs > 0 ? track.scale * GHOST_PACE : 1;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  const t0 = pts[startIdx]!.t;
  for (let j = 0; j < pts.length; j += 1) {
    const p = pts[(startIdx + j) % pts.length]!;
    const rel = p.t - t0 + (p.t < t0 ? lap.timeMs : 0);
    if (t.length && rel * k <= t[t.length - 1]!) continue;
    t.push(rel * k);
    x.push(p.x);
    y.push(p.y);
  }
  // Close the lap back at the first sample.
  t.push(lap.timeMs * k);
  x.push(x[0]!);
  y.push(y[0]!);
  return finish("real", lap.label, lap.timeMs, track, t, x, y);
}

/** Build a ghost from a recorded player lap (x, y, heading triples at 20 Hz). */
export function ghostFromRecording(track: RushTrack, rec: number[], lapMs: number, label: string): Ghost | null {
  const count = Math.floor(rec.length / 3);
  if (count < 20 || lapMs <= 0) return null;
  const t: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < count; i += 1) {
    t.push((i / (count - 1)) * lapMs);
    x.push(rec[i * 3]!);
    y.push(rec[i * 3 + 1]!);
  }
  const g = finish("best", label, 0, track, t, x, y);
  for (let i = 0; i < count; i += 1) g.h[i] = rec[i * 3 + 2]!;
  return g;
}

/** Ghost pose at `ms` into its lap; false once the lap is over. */
export function ghostPose(ghost: Ghost, track: RushTrack, ms: number, hit: TrackHit, out: GhostPose): boolean {
  if (ms < 0 || ms > ghost.lapMs) return false;
  let lo = 0;
  let hi = ghost.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ghost.t[mid]! <= ms) lo = mid;
    else hi = mid;
  }
  const span = ghost.t[hi]! - ghost.t[lo]! || 1;
  const f = (ms - ghost.t[lo]!) / span;
  out.x = ghost.x[lo]! + (ghost.x[hi]! - ghost.x[lo]!) * f;
  out.y = ghost.y[lo]! + (ghost.y[hi]! - ghost.y[lo]!) * f;
  const dh = Math.atan2(Math.sin(ghost.h[hi]! - ghost.h[lo]!), Math.cos(ghost.h[hi]! - ghost.h[lo]!));
  out.heading = ghost.h[lo]! + dh * f;
  projectOnTrack(track, out.x, out.y, hit, hit.i === 0 && lo > 4);
  out.z = heightAt(track, hit.s);
  return true;
}

// ── Saved best laps (this browser) ──
const key = (trackId: string) => `apex.rush.best.${trackId}`;

/** A lap is ~20 Hz x 3 values; this allows far longer than any real lap. */
const MAX_REC = 3 * 20 * 600;

export type SavedBest ={ lapMs: number; rec: number[] };

export function loadBest(trackId: string): SavedBest | null {
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedBest> | null;
    if (!v || typeof v !== "object") return null;
    if (typeof v.lapMs !== "number" || !Number.isFinite(v.lapMs) || v.lapMs <= 0) return null;
    if (!Array.isArray(v.rec) || v.rec.length > MAX_REC || v.rec.length % 3 !== 0) return null;
    if (!v.rec.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return { lapMs: v.lapMs, rec: v.rec };
  } catch {
    return null;
  }
}

export function saveBest(trackId: string, lapMs: number, rec: number[]): void {
  try {
    // 10 cm / 0.01 rad precision keeps a lap around 20 KB.
    const packed = rec.map((v, i) => (i % 3 === 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    localStorage.setItem(key(trackId), JSON.stringify({ lapMs: Math.round(lapMs), rec: packed }));
  } catch {
    // Storage full or blocked: the ghost just isn't kept.
  }
}
