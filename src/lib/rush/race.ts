/**
 * Apex Rush race world: karts, rivals, pickups, laps and places, stepped at a
 * fixed 60 Hz. No DOM, no allocation per tick.
 */
import {
  angDiff,
  BASE_STATS,
  createKart,
  DT,
  EV_BUMP,
  EV_LAP,
  EV_PICKUP,
  MAX_NITRO,
  stepKart,
  type Kart,
  type KartInput,
  type KartStats,
} from "./kart";
import { poseAt, projectOnTrack, rushRng, trackSeed, type RushTrack } from "./track";

export type RushMode = "gp" | "tt";

export type Rival = { name: string; paint: string; accent: string; helmet: string; body: number; skill: number };

export const RIVALS: Rival[] = [
  { name: "Volt", paint: "#f6c343", accent: "#2b2d42", helmet: "#ffffff", body: 1, skill: 1.0 },
  { name: "Mika", paint: "#4cc9f0", accent: "#f72585", helmet: "#f72585", body: 3, skill: 0.985 },
  { name: "Rexx", paint: "#70e000", accent: "#1b4332", helmet: "#ffd166", body: 2, skill: 0.97 },
  { name: "Nova", paint: "#b388ff", accent: "#ffffff", helmet: "#3a0ca3", body: 0, skill: 0.955 },
  { name: "Dune", paint: "#ff8c42", accent: "#3d2c1e", helmet: "#2ec4b6", body: 2, skill: 0.94 },
];

type Ai = {
  lane: number;
  laneT: number;
  skill: number;
  baseTop: number;
  nitroT: number;
  drift: boolean;
  rand: () => number;
};

export type RaceWorld = {
  track: RushTrack;
  mode: RushMode;
  laps: number;
  karts: Kart[];
  ai: Array<Ai | null>;
  /** Self-driving state for the player's kart (after the flag, demo, tests). */
  playerAi: Ai;
  tick: number;
  timeMs: number;
  /** Seconds until each item box respawns (0 = available). */
  boxT: Float32Array;
  /** Player went the wrong way for this long (s). */
  wrongWayT: number;
  /** Player's current-lap recording: x, y, heading triples at 20 Hz. */
  rec: number[];
  /** Best lap recorded this race (same layout as rec), with its time. */
  bestRec: number[] | null;
  bestRecMs: number;
};

const scratch: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createRace(
  track: RushTrack,
  mode: RushMode,
  playerStats: KartStats,
  opts: { rivals?: number; laps?: number } = {},
): RaceWorld {
  const rivalCount = mode === "gp" ? Math.min(RIVALS.length, opts.rivals ?? RIVALS.length) : 0;
  const rand = rushRng(trackSeed(track) ^ 0x9e3779b9);
  const karts: Kart[] = [];
  const ai: Array<Ai | null> = [];
  const total = rivalCount + 1;
  for (let slot = 0; slot < total; slot += 1) {
    // Player starts at the back of the grid.
    const isPlayer = slot === total - 1;
    const rival = isPlayer ? null : RIVALS[slot]!;
    const stats: KartStats = isPlayer ? { ...playerStats } : { ...BASE_STATS, top: BASE_STATS.top * rival!.skill };
    const kart = createKart(isPlayer ? 0 : slot + 1, stats);
    const pose = poseAt(track, track.length - 7 - slot * 4.5, slot % 2 === 0 ? -2.4 : 2.4);
    kart.x = pose.x;
    kart.y = pose.y;
    kart.z = pose.z;
    kart.heading = pose.heading;
    kart.va = pose.heading;
    kart.hit.i = pose.i;
    projectOnTrack(track, kart.x, kart.y, kart.hit, true);
    kart.gate = track.gates - 1;
    kart.progress = kart.hit.s - track.length;
    if (isPlayer) {
      karts.unshift(kart);
      ai.unshift(null);
    } else {
      karts.push(kart);
      ai.push({
        lane: (rand() - 0.5) * 5,
        laneT: 2 + rand() * 4,
        skill: rival!.skill,
        baseTop: stats.top,
        nitroT: 0,
        drift: false,
        rand: rushRng(Math.floor(rand() * 1e9)),
      });
    }
  }
  return {
    track,
    mode,
    laps: opts.laps ?? track.laps,
    karts,
    ai,
    playerAi: { lane: 0, laneT: 1e9, skill: 1, baseTop: playerStats.top, nitroT: 0, drift: false, rand: () => 0.5 },
    tick: 0,
    timeMs: 0,
    boxT: new Float32Array(track.boxes.length),
    wrongWayT: 0,
    rec: [],
    bestRec: null,
    bestRecMs: 0,
  };
}

/** Sharpest signed curvature in the next `dist` metres. */
function curveAhead(track: RushTrack, i: number, dist: number): number {
  const steps = Math.ceil(dist / track.spacing);
  let best = 0;
  for (let o = 0; o <= steps; o += 2) {
    const c = track.curv[(i + o) % track.n]!;
    if (Math.abs(c) > Math.abs(best)) best = c;
  }
  return best;
}

function aiInput(world: RaceWorld, k: Kart, ai: Ai, out: KartInput): void {
  const track = world.track;
  const i = k.hit.i;
  const speed = Math.max(0, k.v);
  const player = world.karts[0]!;

  // Rubber band: ease off when well ahead of the player, push when behind.
  if (world.mode === "gp" && k !== player) {
    const gap = k.progress - player.progress;
    k.stats.top = ai.baseTop * clamp(1 - gap / 900, 0.9, 1.07);
  }

  ai.laneT -= DT;
  if (ai.laneT <= 0) {
    ai.lane = (ai.rand() - 0.5) * 6;
    ai.laneT = 3 + ai.rand() * 5;
  }
  // Take the inside of the next corner, plus the kart's own lane.
  const turn = curveAhead(track, i, 34);
  const inside = clamp(turn * 90, -1, 1) * (track.halfWidth - 2.4);
  let lane = clamp(ai.lane * 0.45 + inside * 0.75, -(track.halfWidth - 1.6), track.halfWidth - 1.6);
  // Step round a kart just ahead.
  for (const other of world.karts) {
    if (other === k) continue;
    const ds = (((other.hit.s - k.hit.s) % track.length) + track.length) % track.length;
    if (ds > 0.5 && ds < 9 && Math.abs(other.hit.d - k.hit.d) < 1.9) {
      lane += other.hit.d > k.hit.d ? -2.6 : 2.6;
      break;
    }
  }
  lane = clamp(lane, -(track.halfWidth - 1.2), track.halfWidth - 1.2);
  const look = clamp(speed * 0.5, 7, 16);
  const tgt = poseAt(track, k.hit.s + look, lane);
  const want = Math.atan2(tgt.y - k.y, tgt.x - k.x);
  const err = angDiff(want, k.heading);
  out.steer = clamp(-err * 2.6, -1, 1);

  // Brake for the tightest corner coming up.
  const grip = 21 * k.stats.handling * (0.92 + 0.1 * ai.skill);
  let allowed = 99;
  const steps = Math.ceil(70 / track.spacing);
  for (let o = 0; o <= steps; o += 2) {
    const c = Math.abs(track.curv[(i + o) % track.n]!);
    if (c < 0.004) continue;
    const corner = Math.sqrt(grip / c);
    const dist = o * track.spacing;
    const v = Math.sqrt(corner * corner + 2 * 16 * dist);
    if (v < allowed) allowed = v;
  }
  out.throttle = speed < allowed ? 1 : 0;
  out.brake = speed > allowed + 1.5 ? 1 : 0;

  // Drift through real corners; let go when the road straightens.
  const here = track.curv[(i + 3) % track.n]!;
  if (!ai.drift) {
    if (Math.abs(here) > 0.028 && Math.abs(out.steer) > 0.35 && speed > 12 && Math.sign(here) === -Math.sign(out.steer)) ai.drift = true;
  } else if (Math.abs(here) < 0.014 || k.drifting === 0) {
    ai.drift = k.drifting !== 0 && Math.abs(here) >= 0.014;
  }
  out.drift = ai.drift;

  // Nitro on a straight.
  out.useItem = false;
  if (k.nitro > 0) {
    ai.nitroT += DT;
    if (ai.nitroT > 1.5 && Math.abs(curveAhead(track, i, 60)) < 0.008) {
      out.useItem = true;
      ai.nitroT = 0;
    }
  }
}

function updateLap(world: RaceWorld, k: Kart, prevS: number): void {
  const track = world.track;
  const seg = Math.min(track.gates - 1, Math.floor((k.hit.s / track.length) * track.gates));
  if (seg === (k.gate + 1) % track.gates) {
    k.gate = seg;
    if (seg === 0) {
      // Time of the crossing inside this tick.
      const past = k.hit.s;
      const moved = past + (track.length - prevS);
      const frac = moved > 0.001 ? clamp(past / moved, 0, 1) : 0;
      const crossMs = world.timeMs - frac * DT * 1000;
      if (k.lap >= 1) {
        k.lastLapMs = crossMs - k.lapStartMs;
        if (k.bestLapMs === 0 || k.lastLapMs < k.bestLapMs) k.bestLapMs = k.lastLapMs;
        k.events |= EV_LAP;
        if (k === world.karts[0]) {
          if (world.bestRec === null || k.lastLapMs <= world.bestRecMs) {
            world.bestRec = world.rec.slice();
            world.bestRecMs = k.lastLapMs;
          }
        }
      }
      if (k === world.karts[0]) world.rec.length = 0;
      k.lapStartMs = crossMs;
      k.lap += 1;
      if (k.lap > world.laps) {
        k.finished = true;
        k.finishMs = crossMs;
        k.lap = world.laps;
      }
    }
  }
  k.progress = k.lap >= 1 ? (k.lap - 1) * track.length + k.hit.s + (k.finished ? track.length : 0) : k.hit.s - track.length;
  // A kart that has passed the line but whose gate has not caught up yet
  // (first samples of a lap) must not jump back a lap in the ordering.
  if (k.lap >= 1 && seg === track.gates - 1 && k.gate === 0) k.progress -= track.length;
}

const order: Kart[] = [];

/** Advance the whole race one tick with the player's input. */
export function stepRace(world: RaceWorld, input: KartInput): void {
  const track = world.track;
  world.tick += 1;
  world.timeMs += DT * 1000;

  for (let n = 0; n < world.karts.length; n += 1) {
    const k = world.karts[n]!;
    const ai = world.ai[n];
    const prevS = k.hit.s;
    if (k.finished) {
      // Cruise after the flag.
      aiInput(world, k, ai ?? world.playerAi, scratch);
      scratch.throttle *= 0.55;
      scratch.drift = false;
      scratch.useItem = false;
      stepKart(k, scratch, track);
    } else if (ai) {
      aiInput(world, k, ai, scratch);
      stepKart(k, scratch, track);
    } else {
      stepKart(k, input, track);
    }
    updateLap(world, k, prevS);

    // Item boxes.
    if (!k.finished) {
      for (let b = 0; b < track.boxes.length; b += 1) {
        if (world.boxT[b]! > 0) continue;
        const box = track.boxes[b]!;
        const dx = k.x - box.x;
        const dy = k.y - box.y;
        if (dx * dx + dy * dy < 4.4) {
          world.boxT[b] = 5;
          if (k.nitro < MAX_NITRO) k.nitro += 1;
          k.events |= EV_PICKUP;
        }
      }
    }
  }
  for (let b = 0; b < world.boxT.length; b += 1) if (world.boxT[b]! > 0) world.boxT[b] = Math.max(0, world.boxT[b]! - DT);

  // Kart-to-kart bumps.
  for (let a = 0; a < world.karts.length; a += 1) {
    for (let b = a + 1; b < world.karts.length; b += 1) {
      const p = world.karts[a]!;
      const q = world.karts[b]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 3.6 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (1.9 - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      const wp = q.stats.weight / (p.stats.weight + q.stats.weight);
      p.x -= nx * push * 2 * wp;
      p.y -= ny * push * 2 * wp;
      q.x += nx * push * 2 * (1 - wp);
      q.y += ny * push * 2 * (1 - wp);
      const dv = p.v - q.v;
      p.v -= dv * 0.12;
      q.v += dv * 0.12;
      p.events |= EV_BUMP;
      q.events |= EV_BUMP;
    }
  }

  // Places.
  order.length = 0;
  for (const k of world.karts) order.push(k);
  order.sort((a, b) => (a.finished && b.finished ? a.finishMs - b.finishMs : b.progress - a.progress));
  for (let n = 0; n < order.length; n += 1) order[n]!.place = n + 1;

  // Player-only bookkeeping.
  const p = world.karts[0]!;
  const i = p.hit.i;
  const along = Math.cos(p.va) * track.tx[i]! + Math.sin(p.va) * track.ty[i]!;
  world.wrongWayT = p.v > 3 && along < -0.4 ? world.wrongWayT + DT : 0;
  if (!p.finished && p.lap >= 1 && world.tick % 3 === 0) world.rec.push(p.x, p.y, p.heading);
}

/** True when every kart has taken the flag (or the player has, in time trial). */
export function raceOver(world: RaceWorld): boolean {
  return world.karts[0]!.finished;
}

/** A self-driving input for the player kart (attract mode and tests). */
export function autopilot(world: RaceWorld, out: KartInput): KartInput {
  aiInput(world, world.karts[0]!, world.playerAi, out);
  return out;
}
