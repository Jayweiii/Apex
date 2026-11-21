/**
 * Apex Sim vehicle model.
 *
 * A planar three-degree-of-freedom chassis (forward speed, side speed, yaw)
 * on four wheels that each spin on their own. Tyre forces come from a
 * load-sensitive magic-formula curve with combined slip, so wheelspin, lock-up
 * and trail-braking rotation fall out of the model instead of being scripted.
 * Wheel loads move with braking, cornering, crests and dips. The driveline is
 * an engine torque curve through a six-speed gearbox and a limited-slip diff.
 *
 * Units are SI. Body axes: x forward, y left. Wheels: 0 FL, 1 FR, 2 RL, 3 RR.
 */
import { groundHeight, projectOnTrack, type SimTrack, type TrackHit } from "./track";

export type CarSpec = {
  name: string;
  /** Kerb mass plus driver (kg). */
  mass: number;
  yawInertia: number;
  wheelbase: number;
  /** Share of static weight on the front axle. */
  frontWeight: number;
  trackFront: number;
  trackRear: number;
  cgHeight: number;
  tyreRadius: number;
  wheelInertia: number;
  engineInertia: number;
  /** Drag area Cd·A (m²). */
  dragArea: number;
  /** Lift area Cl·A (m²), split front/rear. */
  liftFront: number;
  liftRear: number;
  rollingResistance: number;
  /** [rpm, Nm] at full throttle. */
  torqueCurve: Array<[number, number]>;
  idleRpm: number;
  redlineRpm: number;
  /** Forward gear ratios, first to top. */
  gears: number[];
  reverse: number;
  finalDrive: number;
  drivelineEfficiency: number;
  shiftSeconds: number;
  /** Peak brake torque per wheel (Nm). */
  brakeFront: number;
  brakeRear: number;
  /** Largest road-wheel angle (rad). */
  maxSteer: number;
  steeringRatio: number;
  /** Front share of roll stiffness. */
  rollFront: number;
  /** Body roll (rad per m/s² of side force) and pitch (rad per m/s²). */
  rollGain: number;
  pitchGain: number;
  /** Peak tyre friction at nominal load, and how fast it falls with load. */
  grip: number;
  loadSensitivity: number;
  nominalLoad: number;
  /** Slip ratio and slip angle (rad) at peak force. */
  peakSlipRatio: number;
  peakSlipAngle: number;
  /** Limited-slip diff: preload (Nm) and torque-bias share. */
  diffPreload: number;
  diffBias: number;
  length: number;
  width: number;
};

/**
 * Mazda MX-5 (ND2) 2.0, six-speed manual, Club-style limited-slip diff, on
 * 200-treadwear track tyres. Figures are published specifications or
 * well-established estimates (inertia, centre of gravity, tyre curve).
 */
export const ND_MIATA: CarSpec = {
  name: "ND Miata 2.0",
  mass: 1066 + 75,
  yawInertia: 1480,
  wheelbase: 2.31,
  frontWeight: 0.52,
  trackFront: 1.495,
  trackRear: 1.505,
  cgHeight: 0.46,
  tyreRadius: 0.308,
  wheelInertia: 1.15,
  engineInertia: 0.13,
  dragArea: 0.74,
  liftFront: 0.1,
  liftRear: 0.14,
  rollingResistance: 0.014,
  torqueCurve: [
    [800, 120],
    [1500, 158],
    [2500, 182],
    [3200, 196],
    [4000, 205],
    [5000, 203],
    [6000, 197],
    [7000, 184],
    [7500, 168],
    [7800, 120],
  ],
  idleRpm: 850,
  redlineRpm: 7500,
  gears: [5.087, 2.991, 2.035, 1.594, 1.286, 1.0],
  reverse: 4.696,
  finalDrive: 2.866,
  drivelineEfficiency: 0.9,
  shiftSeconds: 0.22,
  brakeFront: 1750,
  brakeRear: 640,
  maxSteer: 0.56,
  steeringRatio: 15.5,
  rollFront: 0.57,
  rollGain: 0.0075,
  pitchGain: 0.0028,
  grip: 1.1,
  loadSensitivity: 0.14,
  nominalLoad: 2800,
  peakSlipRatio: 0.11,
  peakSlipAngle: 0.125,
  diffPreload: 60,
  diffBias: 0.3,
  length: 3.915,
  width: 1.735,
};

export type CarInput = {
  /** −1 (right) … +1 (left), share of the road-wheel lock. */
  steer: number;
  throttle: number;
  brake: number;
  /** +1 / −1 on the tick a shift is requested (manual gearbox). */
  shift: number;
  autoShift: boolean;
  abs: boolean;
  tractionControl: boolean;
};

export const SURFACE_ROAD = 0;
export const SURFACE_KERB = 1;
export const SURFACE_GRASS = 2;

export const EV_SHIFT = 1;
export const EV_OFF = 4;

export type Car = {
  spec: CarSpec;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Body-frame velocity: forward and leftward (m/s). */
  vx: number;
  vy: number;
  yawRate: number;
  /** Road-wheel angle (rad, + = left). */
  steer: number;
  throttle: number;
  brake: number;
  /** −1 reverse, 1…6 forward. */
  gear: number;
  rpm: number;
  shiftTimer: number;
  omega: Float32Array;
  load: Float32Array;
  slipRatio: Float32Array;
  slipAngle: Float32Array;
  surface: Uint8Array;
  absFactor: Float32Array;
  /** Filtered body accelerations that drive load transfer (m/s²). */
  ax: number;
  ay: number;
  roll: number;
  pitch: number;
  /** Road pitch under the car (rad, + = nose up). */
  slope: number;
  hit: TrackHit;
  farCheck: number;
  /** Wheels off the asphalt and kerb right now. */
  wheelsOff: number;
  events: number;
  tcActive: boolean;
  absActive: boolean;
};

const G = 9.81;
const RHO = 1.2;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createCar(spec: CarSpec = ND_MIATA): Car {
  return {
    spec,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    vx: 0,
    vy: 0,
    yawRate: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    rpm: spec.idleRpm,
    shiftTimer: 0,
    omega: new Float32Array(4),
    load: new Float32Array(4).fill((spec.mass * G) / 4),
    slipRatio: new Float32Array(4),
    slipAngle: new Float32Array(4),
    surface: new Uint8Array(4),
    absFactor: new Float32Array(4).fill(1),
    ax: 0,
    ay: 0,
    roll: 0,
    pitch: 0,
    slope: 0,
    hit: { i: 0, s: 0, d: 0 },
    farCheck: 0,
    wheelsOff: 0,
    events: 0,
    tcActive: false,
    absActive: false,
  };
}

/** Put the car on the track at arc length s, offset d, moving at `speed`. */
export function placeCar(car: Car, track: SimTrack, s: number, d = 0, speed = 0): void {
  const f = (((s / track.spacing) % track.n) + track.n) % track.n;
  const i = Math.floor(f);
  car.x = track.px[i]! - track.ty[i]! * d;
  car.y = track.py[i]! + track.tx[i]! * d;
  car.z = track.pz[i]!;
  car.heading = Math.atan2(track.ty[i]!, track.tx[i]!);
  car.vx = speed;
  car.vy = 0;
  car.yawRate = 0;
  car.steer = 0;
  car.ax = 0;
  car.ay = 0;
  car.roll = 0;
  car.pitch = 0;
  car.shiftTimer = 0;
  car.omega.fill(speed / car.spec.tyreRadius);
  car.absFactor.fill(1);
  car.hit.i = i;
  projectOnTrack(track, car.x, car.y, car.hit, true);
  car.gear = 1;
  const sp = car.spec;
  while (car.gear < sp.gears.length && rpmInGear(sp, car.gear, speed) > sp.redlineRpm * 0.9) car.gear += 1;
  car.rpm = Math.max(sp.idleRpm, rpmInGear(sp, car.gear, speed));
}

export function gearRatio(spec: CarSpec, gear: number): number {
  if (gear < 0) return -spec.reverse * spec.finalDrive;
  return spec.gears[clamp(gear, 1, spec.gears.length) - 1]! * spec.finalDrive;
}

export function rpmInGear(spec: CarSpec, gear: number, speed: number): number {
  return ((Math.abs(speed) / spec.tyreRadius) * Math.abs(gearRatio(spec, gear)) * 30) / Math.PI;
}

export function engineTorque(spec: CarSpec, rpm: number): number {
  const c = spec.torqueCurve;
  if (rpm <= c[0]![0]) return c[0]![1];
  for (let i = 1; i < c.length; i += 1) {
    if (rpm <= c[i]![0]) {
      const a = c[i - 1]!;
      const b = c[i]!;
      return a[1] + ((b[1] - a[1]) * (rpm - a[0])) / (b[0] - a[0]);
    }
  }
  return 0;
}

/** Normalised tyre curve: 0 at no slip, 1 at sigma = 1, easing off beyond. */
const TYRE_C = 1.42;
const TYRE_B = Math.tan(Math.PI / (2 * TYRE_C));
function tyreCurve(sigma: number): number {
  return Math.sin(TYRE_C * Math.atan(TYRE_B * sigma));
}

const SURFACE_GRIP = [1, 0.9, 0.48];
const SURFACE_DRAG = [0, 0.004, 0.09];

const wheelX = [0, 0, 0, 0];
const wheelY = [0, 0, 0, 0];
const fxw = [0, 0, 0, 0];
const fyw = [0, 0, 0, 0];
const vlong = [0, 0, 0, 0];
const torque = [0, 0, 0, 0];
const brakeT = [0, 0, 0, 0];

/** Advance the car by `dt` seconds (call at 240 Hz or faster). */
export function stepCar(car: Car, inp: CarInput, track: SimTrack, dt: number): void {
  const sp = car.spec;
  const L = sp.wheelbase;
  const a = L * (1 - sp.frontWeight);
  const b = L * sp.frontWeight;
  const R = sp.tyreRadius;
  const m = sp.mass;

  // ── Controls ──
  const steerTarget = clamp(inp.steer, -1, 1) * sp.maxSteer;
  const steerRate = 1.3;
  car.steer += clamp(steerTarget - car.steer, -steerRate * dt, steerRate * dt);
  car.brake += clamp(clamp(inp.brake, 0, 1) - car.brake, -12 * dt, 9 * dt);
  let throttle = clamp(inp.throttle, 0, 1);

  // ── Gearbox ──
  const speed = Math.hypot(car.vx, car.vy);
  let shift = inp.shift;
  if (car.shiftTimer > 0) {
    car.shiftTimer -= dt;
    shift = 0;
  } else if (inp.autoShift && car.gear > 0) {
    const lower = car.gear > 1 ? rpmInGear(sp, car.gear - 1, car.vx) : Infinity;
    if (car.rpm > sp.redlineRpm - 120 && car.gear < sp.gears.length && car.vx > 2) shift = 1;
    else if (lower < sp.redlineRpm - 900 && (car.rpm < 3300 || (car.brake > 0.25 && lower < sp.redlineRpm - 1400))) shift = -1;
  }
  if (shift > 0 && car.gear < sp.gears.length) {
    car.gear = car.gear < 0 ? 1 : car.gear + 1;
    car.shiftTimer = sp.shiftSeconds;
    car.events |= EV_SHIFT;
  } else if (shift < 0) {
    if (car.gear > 1 && rpmInGear(sp, car.gear - 1, car.vx) < sp.redlineRpm + 300) {
      car.gear -= 1;
      car.shiftTimer = sp.shiftSeconds;
      car.events |= EV_SHIFT;
    } else if (car.gear === 1 && Math.abs(car.vx) < 1.5) {
      car.gear = -1;
      car.shiftTimer = sp.shiftSeconds;
      car.events |= EV_SHIFT;
    }
  }

  // ── Wheel positions, speeds and the surface under each ──
  const cs = Math.cos(car.steer);
  const sn = Math.sin(car.steer);
  const ch = Math.cos(car.heading);
  const sh = Math.sin(car.heading);
  const i0 = car.hit.i;
  const tnx = -track.ty[i0]!;
  const tny = track.tx[i0]!;
  wheelX[0] = a;
  wheelX[1] = a;
  wheelX[2] = -b;
  wheelX[3] = -b;
  wheelY[0] = sp.trackFront / 2;
  wheelY[1] = -sp.trackFront / 2;
  wheelY[2] = sp.trackRear / 2;
  wheelY[3] = -sp.trackRear / 2;
  let off = 0;
  for (let w = 0; w < 4; w += 1) {
    const ox = wheelX[w]! * ch - wheelY[w]! * sh;
    const oy = wheelX[w]! * sh + wheelY[w]! * ch;
    const d = Math.abs(car.hit.d + ox * tnx + oy * tny);
    const surf = d < track.halfWidth ? SURFACE_ROAD : d < track.halfWidth + track.kerb ? SURFACE_KERB : SURFACE_GRASS;
    car.surface[w] = surf;
    if (surf === SURFACE_GRASS) off += 1;
  }
  if (off >= 4 && car.wheelsOff < 4) car.events |= EV_OFF;
  car.wheelsOff = off;

  // ── Wheel loads ──
  const grade = track.grade[i0]!;
  const along = ch * track.tx[i0]! + sh * track.ty[i0]!;
  const vs = car.vx * along;
  const q = 0.5 * RHO * speed * speed;
  const weight = Math.max(0, m * (G / Math.sqrt(1 + grade * grade) + vs * vs * track.vcurv[i0]!));
  const frontStatic = weight * sp.frontWeight - q * sp.liftFront;
  const rearStatic = weight * (1 - sp.frontWeight) - q * sp.liftRear;
  const dLong = (m * car.ax * sp.cgHeight) / L;
  const dLatF = (m * car.ay * sp.cgHeight * sp.rollFront) / sp.trackFront;
  const dLatR = (m * car.ay * sp.cgHeight * (1 - sp.rollFront)) / sp.trackRear;
  car.load[0] = Math.max(0, (frontStatic - dLong) / 2 - dLatF);
  car.load[1] = Math.max(0, (frontStatic - dLong) / 2 + dLatF);
  car.load[2] = Math.max(0, (rearStatic + dLong) / 2 - dLatR);
  car.load[3] = Math.max(0, (rearStatic + dLong) / 2 + dLatR);

  // ── Engine and driveline ──
  const ratio = gearRatio(sp, car.gear);
  const axleOmega = (car.omega[2]! + car.omega[3]!) / 2;
  const wheelRpm = (axleOmega * ratio * 30) / Math.PI;
  const shifting = car.shiftTimer > 0;
  const slipKappa = Math.max(car.slipRatio[2]!, car.slipRatio[3]!) * Math.sign(ratio);
  car.tcActive = false;
  if (inp.tractionControl && slipKappa > 0.16 && speed > 1) {
    throttle *= clamp(1 - (slipKappa - 0.16) * 9, 0.05, 1);
    car.tcActive = true;
  }
  car.throttle = throttle;
  // Below this the clutch slips: the engine holds revs and feeds torque in.
  const clutchRpm = sp.idleRpm + throttle * 3400;
  const clutchSlip = wheelRpm < clutchRpm;
  const targetRpm = shifting ? Math.max(sp.idleRpm, car.rpm - 2500 * dt) : clutchSlip ? clutchRpm : wheelRpm;
  car.rpm += (targetRpm - car.rpm) * Math.min(1, dt * (clutchSlip || shifting ? 9 : 60));
  car.rpm = clamp(car.rpm, sp.idleRpm * 0.9, sp.redlineRpm + 400);
  let engine = 0;
  if (!shifting) {
    const full = car.rpm >= sp.redlineRpm ? 0 : engineTorque(sp, car.rpm);
    const friction = 18 + car.rpm * 0.0055;
    engine = throttle * full - (1 - throttle) * (clutchSlip ? 0 : friction);
  }
  const axleTorque = engine * ratio * sp.drivelineEfficiency;
  const coupled = !shifting && !clutchSlip;
  const rearInertia = sp.wheelInertia + (coupled ? (sp.engineInertia * ratio * ratio) / 2 : 0);
  const lock = clamp(260 * (car.omega[2]! - car.omega[3]!), -(sp.diffPreload + sp.diffBias * Math.abs(axleTorque)), sp.diffPreload + sp.diffBias * Math.abs(axleTorque));
  torque[0] = 0;
  torque[1] = 0;
  torque[2] = axleTorque / 2 - lock;
  torque[3] = axleTorque / 2 + lock;

  // ── Tyres ──
  let fx = 0;
  let fy = 0;
  let mz = 0;
  car.absActive = false;
  for (let w = 0; w < 4; w += 1) {
    const front = w < 2;
    const vwx = car.vx - car.yawRate * wheelY[w]!;
    const vwy = car.vy + car.yawRate * wheelX[w]!;
    const vl = front ? vwx * cs + vwy * sn : vwx;
    const vt = front ? -vwx * sn + vwy * cs : vwy;
    vlong[w] = vl;
    const den = Math.max(Math.abs(vl), 2.5);
    const kappa = (car.omega[w]! * R - vl) / den;
    const alpha = Math.atan2(vt, den);
    car.slipRatio[w] = kappa;
    car.slipAngle[w] = alpha;
    const fz = car.load[w]!;
    const surf = car.surface[w]!;
    const mu = sp.grip * SURFACE_GRIP[surf]! * clamp(1 - sp.loadSensitivity * (fz / sp.nominalLoad - 1), 0.6, 1.25);
    const sx = kappa / sp.peakSlipRatio;
    const sy = Math.tan(alpha) / Math.tan(sp.peakSlipAngle);
    const sigma = Math.hypot(sx, sy);
    let fl = 0;
    let ft = 0;
    if (sigma > 1e-6) {
      const f = mu * fz * tyreCurve(sigma);
      fl = (f * sx) / sigma;
      ft = (-f * sy) / sigma;
    }
    fxw[w] = fl;
    fyw[w] = ft;
    // Rolling resistance and soft-ground drag act on the car, not on wheel spin.
    fl -= (sp.rollingResistance + SURFACE_DRAG[surf]!) * fz * clamp(vl / 0.5, -1, 1);
    const bx = front ? fl * cs - ft * sn : fl;
    const by = front ? fl * sn + ft * cs : ft;
    fx += bx;
    fy += by;
    mz += wheelX[w]! * by - wheelY[w]! * bx;

    // Anti-lock: ease the brake on a wheel that is locking.
    let factor = car.absFactor[w]!;
    if (inp.abs && car.brake > 0.05 && kappa < -0.13 && Math.abs(vl) > 2.5) {
      factor = Math.max(0.08, factor - 14 * dt);
      car.absActive = true;
    } else factor = Math.min(1, factor + 7 * dt);
    car.absFactor[w] = factor;
    brakeT[w] = car.brake * factor * (front ? sp.brakeFront : sp.brakeRear);
  }

  // ── Wheel spin (implicit in the tyre force so it stays stable when slow) ──
  for (let w = 0; w < 4; w += 1) {
    const inertia = w < 2 ? sp.wheelInertia : rearInertia;
    const den = Math.max(Math.abs(vlong[w]!), 2.5);
    const stiff = (sp.grip * car.load[w]! * TYRE_B * TYRE_C) / sp.peakSlipRatio;
    const gain = 1 / (1 + (dt * stiff * R * R) / (inertia * den));
    let om = car.omega[w]! + ((torque[w]! - fxw[w]! * R) / inertia) * dt * gain;
    const hold = (brakeT[w]! / inertia) * dt * gain;
    if (Math.abs(om) <= hold) om = 0;
    else om -= Math.sign(om) * hold;
    car.omega[w] = om;
  }

  // ── Chassis ──
  const drag = q * sp.dragArea;
  if (speed > 0.01) {
    fx -= (drag * car.vx) / speed;
    fy -= (drag * car.vy) / speed;
  }
  // Gravity along the slope (the road has no cross-fall).
  const gx = -m * G * grade * along;
  const gy = m * G * grade * (sh * track.tx[i0]! - ch * track.ty[i0]!);
  const accX = (fx + gx) / m;
  const accY = (fy + gy) / m;
  car.vx += (accX + car.yawRate * car.vy) * dt;
  car.vy += (accY - car.yawRate * car.vx) * dt;
  car.yawRate += (mz / sp.yawInertia) * dt;
  // At a standstill with the brake on, hold still instead of creeping.
  if (speed < 0.3 && car.brake > 0.2 && throttle < 0.05) {
    car.vx *= 0.8;
    car.vy *= 0.8;
    car.yawRate *= 0.8;
  }
  car.heading += car.yawRate * dt;
  const nch = Math.cos(car.heading);
  const nsh = Math.sin(car.heading);
  car.x += (car.vx * nch - car.vy * nsh) * dt;
  car.y += (car.vx * nsh + car.vy * nch) * dt;

  // Load transfer follows the tyre forces through the springs, not instantly.
  const lag = Math.min(1, dt / 0.07);
  car.ax += (fx / m - car.ax) * lag;
  car.ay += (fy / m - car.ay) * lag;
  car.roll = car.ay * sp.rollGain;
  car.pitch = -car.ax * sp.pitchGain;

  // ── Track position and ground height ──
  projectOnTrack(track, car.x, car.y, car.hit);
  // Far from this stretch of road the car may be nearer another: look again.
  if (Math.abs(car.hit.d) > 22) {
    car.farCheck -= dt;
    if (car.farCheck <= 0) {
      projectOnTrack(track, car.x, car.y, car.hit, true);
      car.farCheck = 0.25;
    }
  }
  const k = car.hit.i;
  car.z = groundHeight(track, car.x, car.y, car.hit);
  car.slope = Math.atan(track.grade[k]! * (nch * track.tx[k]! + nsh * track.ty[k]!));
}

export function carSpeed(car: Car): number {
  return Math.hypot(car.vx, car.vy);
}
