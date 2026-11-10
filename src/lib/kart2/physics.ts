import type { LiveryStats } from "./livery";
import { clamp, leftTurn, wrapAngle } from "./math";
import {
  createTrackHit,
  poseAt,
  projectOnTrack,
  type Kart2Track,
  type TrackHit,
} from "./track";

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

const DRIVE_ACCEL = 12.5;
const BRAKE_ACCEL = 18;
const YAW_STIFF = 7.5;
const YAW_MAX = 2.65;
const DRIFT_YAW_MAX = 2.05;
const DRIFT_ENTER_SPEED = 8;
const DRIFT_ENTER_ANGLE = 0.7;
const DRIFT_FLICK_OMEGA = 3.1;
const DRIFT_FLICK_ANGLE = 0.36;
const GRIP = 9.2;
const DRIFT_GRIP = 2.05;
const GRASS_GRIP = 3.1;
const BOOST_TIERS = [0.4, 0.92, 1.6];

export type Kart2Input = {
  /** Stick is pushed (false = brake, no heading command). */
  active: boolean;
  /** Desired world heading when active. */
  heading: number;
  throttle: number;
  /** How fast the stick's direction is changing, rad/s. */
  stickOmega: number;
  /** Keyboard / gamepad drift hold. */
  drift: boolean;
};

export type Kart2State = {
  x: number;
  y: number;
  z: number;
  heading: number;
  vx: number;
  vy: number;
  speed: number;
  /** Signed angle between velocity and heading (rad). */
  slip: number;
  /** Accumulated leftward yaw (rad). Positive means the kart has turned left. */
  turnedLeft: number;
  drifting: boolean;
  driftTime: number;
  alignTime: number;
  /** Mini-turbo meter, 0 until the first tier. */
  charge: number;
  boost: number;
  boostTier: number;
  s: number;
  prevS: number;
  progress: number;
  lap: number;
  lapTime: number;
  lastLap: number;
  hit: TrackHit;
  grip: number;
  speedMul: number;
  grade: number;
};

export function neutralInput(heading = 0): Kart2Input {
  return { active: false, heading, throttle: 0, stickOmega: 0, drift: false };
}

export function createKart(track: Kart2Track, stats: LiveryStats): Kart2State {
  const spawn = poseAt(track, 8, 0);
  const hit = createTrackHit();
  projectOnTrack(track, spawn.x, spawn.y, hit);
  return {
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    heading: spawn.heading,
    vx: 0,
    vy: 0,
    speed: 0,
    slip: 0,
    turnedLeft: 0,
    drifting: false,
    driftTime: 0,
    alignTime: 0,
    charge: 0,
    boost: 0,
    boostTier: 0,
    s: hit.s,
    prevS: hit.s,
    progress: 0,
    lap: 1,
    lapTime: 0,
    lastLap: 0,
    hit,
    grip: stats.grip,
    speedMul: stats.speed,
    grade: hit.grade,
  };
}

function endDrift(k: Kart2State) {
  let tier = 0;
  if (k.charge >= BOOST_TIERS[2]!) tier = 3;
  else if (k.charge >= BOOST_TIERS[1]!) tier = 2;
  else if (k.charge >= BOOST_TIERS[0]!) tier = 1;
  k.drifting = false;
  k.driftTime = 0;
  k.alignTime = 0;
  if (tier > 0 && k.speed > 4) {
    k.boost = 0.62 + tier * 0.28;
    k.boostTier = tier;
    const kick = 2.4 + tier * 1.35;
    k.vx += Math.sin(k.heading) * kick;
    k.vy += Math.cos(k.heading) * kick;
  }
  k.charge = 0;
}

/** One fixed step. Mutates `k` only. */
export function stepKart(k: Kart2State, input: Kart2Input, track: Kart2Track, dt: number) {
  projectOnTrack(track, k.x, k.y, k.hit);
  const idx = k.hit.index;
  const onGrass = Math.abs(k.hit.d) > track.halfWidth;
  const speed = Math.hypot(k.vx, k.vy);
  const yawErr = input.active ? wrapAngle(input.heading - k.heading) : 0;

  const sharp =
    input.active &&
    speed > DRIFT_ENTER_SPEED &&
    Math.abs(yawErr) > DRIFT_ENTER_ANGLE &&
    input.throttle > 0.34;
  const flick =
    input.active &&
    speed > DRIFT_ENTER_SPEED &&
    Math.abs(input.stickOmega) > DRIFT_FLICK_OMEGA &&
    Math.abs(yawErr) > DRIFT_FLICK_ANGLE &&
    input.throttle > 0.28;
  const button = input.drift && input.active && speed > 7 && input.throttle > 0.15;
  if (!k.drifting && (sharp || flick || button)) {
    k.drifting = true;
    k.driftTime = 0;
    k.alignTime = 0;
  }

  const drifting = k.drifting;
  const slow = 1 - clamp(speed / 26, 0, 1);
  const yawMax = drifting ? DRIFT_YAW_MAX : YAW_MAX * (0.78 + 0.22 * slow);
  const yaw = input.active
    ? clamp(yawErr * (drifting ? 3.3 : YAW_STIFF), -yawMax, yawMax)
    : 0;
  const prevHeading = k.heading;
  k.heading = wrapAngle(k.heading + yaw * dt);
  k.turnedLeft += leftTurn(prevHeading, k.heading);

  const fx = Math.sin(k.heading);
  const fy = Math.cos(k.heading);
  const rx = Math.cos(k.heading);
  const ry = -Math.sin(k.heading);
  const headingAlong = fx * track.tx[idx]! + fy * track.ty[idx]!;
  const grade = k.hit.grade;
  const sinSlope = grade / Math.sqrt(1 + grade * grade);
  let gradeAcc = -9.81 * sinSlope * headingAlong;
  if (!input.active && speed < 0.7) gradeAcc = 0;

  const boostAcc = k.boost > 0 ? 5.2 + k.boostTier * 1.7 : 0;
  const drive =
    (input.active ? DRIVE_ACCEL * input.throttle * k.speedMul : 0) + boostAcc;
  k.vx += fx * (drive + gradeAcc) * dt;
  k.vy += fy * (drive + gradeAcc) * dt;

  if (!input.active) {
    const sp = Math.hypot(k.vx, k.vy);
    const dec = Math.min(sp, BRAKE_ACCEL * dt);
    if (sp > 1e-4) {
      k.vx -= (k.vx / sp) * dec;
      k.vy -= (k.vy / sp) * dec;
    }
  }

  let fwd = k.vx * fx + k.vy * fy;
  let lat = k.vx * rx + k.vy * ry;
  const gripBase = onGrass ? GRASS_GRIP : drifting ? DRIFT_GRIP : GRIP;
  const grip = gripBase * (drifting ? 1 : k.grip);
  lat *= Math.exp(-grip * dt);
  if (fwd < 0) fwd *= Math.exp(-16 * dt);
  const sp2 = Math.hypot(fwd, lat);
  const drag = (0.018 * sp2 + (onGrass ? 5.2 : 0.28)) * dt;
  const keep = sp2 > 1e-4 ? Math.max(0, sp2 - drag) / sp2 : 0;
  fwd *= keep;
  lat *= keep;
  const top = (k.boost > 0 ? 36 + k.boostTier * 2 : 31.5) * k.speedMul;
  if (fwd > top) fwd = top;
  k.vx = fx * fwd + rx * lat;
  k.vy = fy * fwd + ry * lat;

  k.x += k.vx * dt;
  k.y += k.vy * dt;
  projectOnTrack(track, k.x, k.y, k.hit);

  const wall = track.halfWidth + 7;
  if (Math.abs(k.hit.d) > wall) {
    const sign = Math.sign(k.hit.d);
    const over = Math.abs(k.hit.d) - (wall - 0.4);
    const leftX = -track.ty[k.hit.index]!;
    const leftY = track.tx[k.hit.index]!;
    k.x -= leftX * sign * over;
    k.y -= leftY * sign * over;
    const outward = (k.vx * leftX + k.vy * leftY) * sign;
    if (outward > 0) {
      k.vx -= leftX * sign * outward * 1.05;
      k.vy -= leftY * sign * outward * 1.05;
    }
    k.vx *= 0.9;
    k.vy *= 0.9;
    projectOnTrack(track, k.x, k.y, k.hit);
  }

  k.speed = Math.hypot(k.vx, k.vy);
  fwd = k.vx * fx + k.vy * fy;
  lat = k.vx * rx + k.vy * ry;
  k.slip = Math.atan2(lat, Math.max(0.45, fwd));
  k.z = k.hit.z;
  k.grade = k.hit.grade;

  if (k.drifting) {
    k.driftTime += dt;
    const held = input.drift || (input.active && Math.abs(yawErr) > 0.32);
    if (held) k.alignTime = 0;
    else k.alignTime += dt;
    if (k.speed > 6 && Math.abs(k.slip) > 0.1) {
      k.charge = Math.min(2.5, k.charge + Math.abs(k.slip) * k.speed * 0.09 * dt);
    }
    if (k.speed < 5 || k.alignTime > 0.16 || (!input.active && k.alignTime > 0.04)) {
      endDrift(k);
    }
  } else if (k.charge > 0 && k.boost <= 0) {
    k.charge = Math.max(0, k.charge - dt * 0.85);
  }
  if (k.boost > 0) k.boost = Math.max(0, k.boost - dt);

  const len = track.length;
  let ds = k.hit.s - k.prevS;
  if (ds > len * 0.5) ds -= len;
  if (ds < -len * 0.5) ds += len;
  if (ds > 0) k.progress += ds;
  if (k.prevS > len * 0.72 && k.hit.s < len * 0.28 && k.progress > len * 0.55) {
    k.lap += 1;
    k.lastLap = k.lapTime;
    k.lapTime = 0;
    k.progress = k.hit.s;
  }
  k.prevS = k.hit.s;
  k.s = k.hit.s;
  k.lapTime += dt;
}
