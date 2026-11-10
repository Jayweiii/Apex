/**
 * Apex Rush kart handling: an arcade model built for drifting.
 *
 * The kart has a facing (`heading`) and a travel direction (`va`). With grip
 * the travel direction snaps to the facing. In a drift it lags behind, so the
 * kart slides round the corner nose-in, and holding the slide charges a
 * mini-turbo that fires when the drift is released.
 */
import { heightAt, projectOnTrack, type RushTrack, type TrackHit } from "./track";

export type KartStats = {
  /** Top speed (m/s). */
  top: number;
  /** Acceleration scale. */
  accel: number;
  /** Turn-rate scale. */
  handling: number;
  /** Mini-turbo charge-rate scale. */
  drift: number;
  /** Mass scale, for bumps. */
  weight: number;
};

export const BASE_STATS: KartStats = { top: 27, accel: 1, handling: 1, drift: 1, weight: 1 };

export type KartInput = {
  /** −1 (left) … +1 (right). */
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  useItem: boolean;
};

export type Kart = {
  id: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Travel direction (rad). */
  va: number;
  /** Speed along the travel direction (m/s, negative in reverse). */
  v: number;
  steer: number;
  /** −1 = drifting left, +1 = right, 0 = gripping. */
  drifting: number;
  /** Mini-turbo charge (s of weighted drift time). */
  charge: number;
  /** 0 none, 1 blue, 2 orange, 3 purple. */
  chargeLevel: number;
  boostT: number;
  /** Strength of the running boost (extra top-speed fraction). */
  boostPow: number;
  hopT: number;
  /** Seconds since the last wall hit started (counts down). */
  wallT: number;
  offroad: boolean;
  hit: TrackHit;
  stats: KartStats;
  nitro: number;
  itemPrev: boolean;
  padCooldown: number;
  /** Events raised this tick, for sound and effects (bit flags). */
  events: number;
  // Race state.
  lap: number;
  gate: number;
  progress: number;
  finished: boolean;
  finishMs: number;
  lapStartMs: number;
  lastLapMs: number;
  bestLapMs: number;
  place: number;
};

export const EV_DRIFT_START = 1;
export const EV_BOOST = 2;
export const EV_WALL = 4;
export const EV_PICKUP = 8;
export const EV_PAD = 16;
export const EV_LAP = 32;
export const EV_BUMP = 64;
export const EV_CHARGE = 128;

export const DT = 1 / 60;
export const DRIFT_MIN_SPEED = 9;
/** Drift time (weighted s) for each mini-turbo level. */
export const CHARGE_LEVELS = [0.55, 1.35, 2.4];
/** Boost seconds per mini-turbo level. */
export const BOOST_SECONDS = [0, 0.7, 1.25, 2.0];
export const MAX_NITRO = 3;

const ACCEL = 11.5;
const BRAKE = 24;
const LAT_GRIP = 21; // m/s² the tyres turn with
const MIN_RADIUS = 4.2;
const GRAVITY_PULL = 7.5;
const OFFROAD_TOP = 0.5;
const KART_HALF_WIDTH = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function angDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function createKart(id: number, stats: KartStats): Kart {
  return {
    id,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    va: 0,
    v: 0,
    steer: 0,
    drifting: 0,
    charge: 0,
    chargeLevel: 0,
    boostT: 0,
    boostPow: 0,
    hopT: 0,
    wallT: 0,
    offroad: false,
    hit: { i: 0, s: 0, d: 0 },
    stats,
    nitro: 0,
    itemPrev: false,
    padCooldown: 0,
    events: 0,
    lap: 0,
    gate: 0,
    progress: 0,
    finished: false,
    finishMs: 0,
    lapStartMs: 0,
    lastLapMs: 0,
    bestLapMs: 0,
    place: 1,
  };
}

export function startBoost(k: Kart, seconds: number, pow: number): void {
  if (seconds > k.boostT) k.boostT = seconds;
  if (pow > k.boostPow || k.boostT === seconds) k.boostPow = Math.max(pow, k.boostPow);
  k.events |= EV_BOOST;
}

function endDrift(k: Kart, reward: boolean): void {
  if (reward && k.chargeLevel > 0) startBoost(k, BOOST_SECONDS[k.chargeLevel]!, 0.22 + 0.04 * k.chargeLevel);
  k.drifting = 0;
  k.charge = 0;
  k.chargeLevel = 0;
}

/** Advance one kart by one fixed tick. Allocation-free. */
export function stepKart(k: Kart, inp: KartInput, track: RushTrack): void {
  const st = k.stats;
  const dt = DT;
  k.events = 0;

  // Smooth the steering a touch so keys and stick feel alike.
  const target = clamp(inp.steer, -1, 1);
  k.steer += clamp(target - k.steer, -9 * dt, 9 * dt);
  const speed = Math.abs(k.v);

  // Item: nitro.
  if (inp.useItem && !k.itemPrev && k.nitro > 0) {
    k.nitro -= 1;
    startBoost(k, 1.5, 0.34);
  }
  k.itemPrev = inp.useItem;

  // Drift state.
  if (k.drifting === 0) {
    if (inp.drift && Math.abs(k.steer) > 0.22 && k.v > DRIFT_MIN_SPEED && !k.offroad && k.wallT <= 0) {
      k.drifting = k.steer > 0 ? 1 : -1;
      k.charge = 0;
      k.chargeLevel = 0;
      k.hopT = 0.2;
      k.events |= EV_DRIFT_START;
    }
  } else if (!inp.drift) {
    endDrift(k, true);
  } else if (k.v < DRIFT_MIN_SPEED * 0.7 || k.offroad) {
    endDrift(k, false);
  }

  // Yaw. Tyres can turn the kart at LAT_GRIP m/s², or MIN_RADIUS when slow.
  const gripRate = Math.min(speed / MIN_RADIUS, LAT_GRIP / Math.max(speed, 0.1)) * st.handling;
  let yaw: number;
  if (k.drifting !== 0) {
    // Steering into the drift tightens it, away opens it. It never straightens.
    const inward = clamp(k.steer * k.drifting, -1, 1);
    yaw = -k.drifting * gripRate * (1.12 + 0.62 * inward);
    const before = k.chargeLevel;
    k.charge += dt * (0.6 + 0.7 * Math.max(0, inward)) * st.drift;
    k.chargeLevel = k.charge >= CHARGE_LEVELS[2]! ? 3 : k.charge >= CHARGE_LEVELS[1]! ? 2 : k.charge >= CHARGE_LEVELS[0]! ? 1 : 0;
    if (k.chargeLevel > before) k.events |= EV_CHARGE;
  } else {
    yaw = -k.steer * gripRate;
  }
  if (k.v < 0) yaw = -yaw;
  k.heading += yaw * dt;

  // Travel direction follows the facing: instantly with grip, lazily in a drift.
  const follow = k.drifting !== 0 ? 2.6 : k.wallT > 0 ? 4 : 11;
  const slip = angDiff(k.heading, k.va);
  k.va += slip * Math.min(1, follow * dt);

  // Speed.
  const boosting = k.boostT > 0;
  let top = st.top * (boosting ? 1 + k.boostPow : 1);
  if (k.offroad && !boosting) top *= OFFROAD_TOP;
  let acc = 0;
  if (k.v >= 0) {
    const ratio = clamp(k.v / top, 0, 1.2);
    acc += inp.throttle * ACCEL * st.accel * (1 - ratio * ratio);
    if (boosting && k.v < top) acc += 16;
    if (k.v > top) acc -= (k.v - top) * (k.offroad ? 3.2 : 1.6);
    acc -= inp.brake * BRAKE;
    acc -= 0.5 + 0.01 * k.v;
  } else {
    acc += inp.throttle * ACCEL + 3;
  }
  // Reverse: brake held at a standstill.
  if (inp.brake > 0 && inp.throttle === 0 && k.v <= 0.3 && k.v > -6) acc = -5;
  // Hills: gravity along the direction of travel.
  const i = k.hit.i;
  const along = Math.cos(k.va) * track.tx[i]! + Math.sin(k.va) * track.ty[i]!;
  acc -= GRAVITY_PULL * track.grade[i]! * along * (k.v >= 0 ? 1 : -1);
  // Sliding scrubs a little speed (less in a held drift).
  acc -= Math.abs(slip) * speed * (k.drifting !== 0 ? 0.28 : 0.9);
  k.v += acc * dt;
  if (inp.throttle === 0 && inp.brake === 0 && Math.abs(k.v) < 0.3) k.v = 0;
  if (inp.brake > 0 && inp.throttle === 0 && k.v < 0 && k.v > -0.2 && acc > 0) k.v = 0;

  k.x += Math.cos(k.va) * k.v * dt;
  k.y += Math.sin(k.va) * k.v * dt;

  // Track: surface, wall, height.
  projectOnTrack(track, k.x, k.y, k.hit);
  const hit = k.hit;
  const absD = Math.abs(hit.d);
  k.offroad = absD > track.halfWidth + 0.8;
  // The wall stops the kart's side, not its centre.
  const limit = track.halfWidth + track.runoff - KART_HALF_WIDTH;
  if (absD > limit) {
    const j = hit.i;
    const sign = hit.d > 0 ? 1 : -1;
    const over = absD - limit;
    // Push back inside and turn the travel direction along the wall.
    k.x += track.ty[j]! * sign * over;
    k.y -= track.tx[j]! * sign * over;
    const wallDir = Math.atan2(track.ty[j]!, track.tx[j]!) + (k.v < 0 ? Math.PI : 0);
    const into = Math.abs(Math.sin(angDiff(k.va, wallDir)));
    k.va = wallDir + angDiff(k.va, wallDir) * 0.25;
    k.heading += angDiff(k.va, k.heading) * 0.5;
    if (k.wallT <= 0 && into * speed > 2) k.events |= EV_WALL;
    k.v *= 1 - Math.min(0.5, into * 0.6);
    k.wallT = 0.35;
    if (k.drifting !== 0) endDrift(k, false);
    hit.d = sign * limit;
  }
  if (k.wallT > 0) k.wallT -= dt;
  if (k.boostT > 0) {
    k.boostT -= dt;
    if (k.boostT <= 0) k.boostPow = 0;
  }
  if (k.hopT > 0) k.hopT -= dt;
  if (k.padCooldown > 0) k.padCooldown -= dt;
  const hop = k.hopT > 0 ? Math.sin((1 - k.hopT / 0.2) * Math.PI) * 0.45 : 0;
  k.z = heightAt(track, hit.s) + hop;

  // Boost pads.
  if (k.padCooldown <= 0) {
    for (const pad of track.pads) {
      const dx = k.x - pad.x;
      const dy = k.y - pad.y;
      if (dx * dx + dy * dy < 9) {
        startBoost(k, 1.1, 0.3);
        k.padCooldown = 1.5;
        k.events |= EV_PAD;
        break;
      }
    }
  }
}
