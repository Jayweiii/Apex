/**
 * 4-wheel planar car (issue #44 physics): per-wheel loads with longitudinal
 * and lateral load transfer, Pacejka lateral forces, friction ellipse,
 * RWD with a limited-slip diff, and a handbrake that locks the rears.
 *
 * Hot path: `stepCar` allocates nothing — all state lives on `KartCar`.
 */
import {
  clampLongitudinal,
  DEFAULT_TIRE,
  lateralForce,
  peakForce,
  type TireParams,
} from "./tire";

export const GRAVITY = 9.81;

/** Below this speed (m/s) the handbrake is a light brake, not a drift. */
export const DRIFT_MIN_SPEED = 6;
/** Yaw-rate kick (rad/s) when a drift starts at speed. */
const DRIFT_KICK = 0.55;
/** Yaw damping while drifting (1/s). */
const DRIFT_YAW_DAMP = 1.4;

export type CarParams = {
  massKg: number;
  /** Yaw inertia, kg·m². */
  izz: number;
  wheelbaseM: number;
  trackWidthM: number;
  cgHeightM: number;
  /** Static front weight fraction (0.52 = 52/48). */
  frontFrac: number;
  /** Peak drive force at low speed, N (engine × gearing, simplified). */
  driveForceN: number;
  /** Engine power cap, W (drive force falls off as P/v). */
  powerW: number;
  /** Top speed, m/s (soft limit via drag). */
  topSpeed: number;
  brakeForceN: number;
  /** Front share of braking. */
  brakeBiasFront: number;
  /** Max steer angle at the wheels, rad. */
  maxSteer: number;
  /** Steer slew rate, rad/s. */
  steerRate: number;
  /** Limited-slip torque bias ratio (1 = open diff). */
  lsdBias: number;
  /** Rear tires grip less while the handbrake is on (locked wheel). */
  handbrakeLateral: number;
  frontTire: TireParams;
  rearTire: TireParams;
};

/** Miata-like default: ~1050 kg, 52/48, RWD + LSD. */
export const DEFAULT_CAR: CarParams = {
  massKg: 1050,
  izz: 1900,
  wheelbaseM: 2.31,
  trackWidthM: 1.45,
  cgHeightM: 0.38,
  frontFrac: 0.52,
  // ~6.5 m/s² off the line (about 0→80 km/h in 3.5 s): near the rear
  // tires' traction limit, so launches feel punchy and the rear still steps
  // out under power. Cornering with full throttle is capped (see stepCar).
  driveForceN: 6800,
  powerW: 140000,
  topSpeed: 46,
  brakeForceN: 11500,
  brakeBiasFront: 0.7,
  maxSteer: 0.6,
  steerRate: 3.4,
  lsdBias: 2.6,
  handbrakeLateral: 0.5,
  frontTire: DEFAULT_TIRE,
  // Same grip front and rear: stable at the limit, so slides come from
  // throttle / handbrake / weight transfer, not from just turning in.
  rearTire: DEFAULT_TIRE,
};

export type CarInput = {
  /** −1 (left) … 1 (right). */
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
};

export type KartCar = {
  params: CarParams;
  /** World position (m) and heading (rad, 0 = +x, CCW positive). */
  x: number;
  y: number;
  heading: number;
  /** Body-frame velocity: vx forward, vy left (m/s); yaw rate r (rad/s). */
  vx: number;
  vy: number;
  r: number;
  /** Current wheel steer angle (rad, + = left). */
  steer: number;
  /** Last body accelerations, used for next step's load transfer. */
  ax: number;
  ay: number;
  /** Wheel loads FL, FR, RL, RR (N). */
  fz: Float64Array;
  /** Rear slip angle (rad) and drive "slip" usage 0…1 — for smoke/score. */
  rearSlip: number;
  frontSlip: number;
  driveUsage: number;
  /** Surface grip multipliers (1 = asphalt). Set by the race each tick. */
  surfaceMu: number;
  rearMuScale: number;
  extraDrag: number;
  /** Extra drive force from a Turbo (N). */
  boostForce: number;
  /** Extra top speed while a boost is active (m/s). Set by the race. */
  topBonus: number;
  /** Drifting last step, to detect the tap that starts a drift. */
  hbPrev: boolean;
};

/** Aero (N per (m/s)^2) and rolling resistance (N) along the body x axis. */
export const DRAG_QUAD = 0.42;
export const DRAG_ROLL = 140;
/** Longitudinal drag force at forward speed vx (m/s), excluding extraDrag. */
export function dragForce(vx: number): number {
  return DRAG_QUAD * vx * Math.abs(vx) + DRAG_ROLL * Math.sign(vx);
}

export function createCar(params: CarParams = DEFAULT_CAR): KartCar {
  const car: KartCar = {
    params,
    x: 0,
    y: 0,
    heading: 0,
    vx: 0,
    vy: 0,
    r: 0,
    steer: 0,
    ax: 0,
    ay: 0,
    fz: new Float64Array(4),
    rearSlip: 0,
    frontSlip: 0,
    driveUsage: 0,
    surfaceMu: 1,
    rearMuScale: 1,
    extraDrag: 0,
    boostForce: 0,
    topBonus: 0,
    hbPrev: false,
  };
  computeLoads(car);
  return car;
}

/**
 * Wheel loads from the static split plus load transfer from last step's
 * accelerations. Always sums to m·g (tested).
 */
export function computeLoads(car: KartCar): void {
  const p = car.params;
  const w = p.massKg * GRAVITY;
  const front = w * p.frontFrac;
  const rear = w - front;
  // Longitudinal: accelerating moves load to the rear.
  const dLong = (p.massKg * car.ax * p.cgHeightM) / p.wheelbaseM;
  // Lateral: positive ay (to the left) moves load to the right wheels.
  const dLat = (p.massKg * car.ay * p.cgHeightM) / p.trackWidthM;
  const frontAxle = Math.max(0, front - dLong);
  const rearAxle = Math.max(0, rear + dLong);
  const total = frontAxle + rearAxle || 1;
  // Keep the total exact even when an axle would go negative.
  const fScale = w / total;
  const fa = frontAxle * fScale;
  const ra = rearAxle * fScale;
  const latF = dLat * p.frontFrac;
  const latR = dLat * (1 - p.frontFrac);
  const fl = clamp(fa / 2 - latF, 0, fa);
  const rl = clamp(ra / 2 - latR, 0, ra);
  car.fz[0] = fl;
  car.fz[1] = fa - fl;
  car.fz[2] = rl;
  car.fz[3] = ra - rl;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Advance the car by dt seconds. Allocation-free. */
export function stepCar(car: KartCar, input: CarInput, dt: number): void {
  const p = car.params;
  const m = p.massKg;
  const a = p.wheelbaseM * (1 - p.frontFrac); // CG → front axle
  const b = p.wheelbaseM * p.frontFrac; // CG → rear axle
  const mu = car.surfaceMu;

  // Steering: slew toward the target, less lock at speed (arcade-friendly).
  const speed = Math.hypot(car.vx, car.vy);
  // Softer lock at crawling speed so a short tap doesn't whip the nose round.
  const lowSpeed = 0.7 + 0.3 * clamp(speed / 9, 0, 1);
  const lockScale = lowSpeed / (1 + speed * 0.075);
  const target = -clamp(input.steer, -1, 1) * p.maxSteer * lockScale;
  const maxDelta = p.steerRate * dt;
  car.steer += clamp(target - car.steer, -maxDelta, maxDelta);

  computeLoads(car);
  const fzF = car.fz[0] + car.fz[1];
  const fzR = car.fz[2] + car.fz[3];

  // ── Longitudinal (rear-wheel drive through an LSD) ──
  const vAbs = Math.max(Math.abs(car.vx), 0.1);
  const engine = Math.min(p.driveForceN, p.powerW / Math.max(vAbs, 4));
  let driveReq = input.throttle * engine + car.boostForce;
  if (car.vx > p.topSpeed + car.topBonus) driveReq *= 0.2;
  // LSD: open diff sends 2× the weaker wheel's grip; bias ratio lets the
  // locked side carry more, up to the axle's total grip.
  const capL = peakForce(car.fz[2], p.rearTire, mu * car.rearMuScale);
  const capR = peakForce(car.fz[3], p.rearTire, mu * car.rearMuScale);
  const rearDriveCap = Math.min(capL + capR, 2 * Math.min(capL, capR) * p.lsdBias);

  const brakeTotal = input.brake * p.brakeForceN;
  const dir = car.vx >= 0 ? 1 : -1;
  let fxRear: number;
  let fxFront: number;
  // Below DRIFT_MIN_SPEED the handbrake is just a light brake; above it, it
  // starts a drift that keeps most of your speed.
  const slideBrake = input.handbrake && Math.abs(car.vx) > 0.5;
  const drifting = slideBrake && Math.abs(car.vx) >= DRIFT_MIN_SPEED;
  if (slideBrake && !drifting) {
    // Light brake: throttle still drives, rears only scrub a little, and
    // side grip stays intact so there is no stall-out at crawling speed.
    fxRear = clamp(driveReq, -rearDriveCap, rearDriveCap) - dir * (capL + capR) * 0.12;
  } else if (drifting) {
    // Throttle still pulls through the slide; rears only scrub a little.
    fxRear = clamp(driveReq, -rearDriveCap, rearDriveCap) * 0.7 - dir * (capL + capR) * 0.1;
  } else {
    // Pinned throttle mid-corner would use all the rear grip; keep some for
    // side force unless the wheel is nearly straight.
    const cornerCap = 1 - 0.2 * clamp(Math.abs(input.steer) * 2, 0, 1);
    fxRear = clamp(driveReq, -rearDriveCap * cornerCap, rearDriveCap * cornerCap);
    // ABS: braking never takes more than 75% of an axle's grip, so the
    // tires keep side grip and braking into a corner doesn't spin you.
    const rearBrakeCap = 0.75 * (capL + capR);
    fxRear -= dir * Math.min(brakeTotal * (1 - p.brakeBiasFront), rearBrakeCap);
    fxRear = clampLongitudinal(fxRear, fzR, p.rearTire, mu * car.rearMuScale);
  }
  // Reverse: brake held at (near) standstill backs up slowly.
  if (input.brake > 0 && input.throttle === 0 && car.vx < 0.8) {
    fxRear = -0.35 * p.driveForceN * input.brake;
    fxFront = 0;
  } else {
    const frontBrakeCap = 0.75 * peakForce(fzF, p.frontTire, mu);
    fxFront = -dir * Math.min(brakeTotal * p.brakeBiasFront, frontBrakeCap);
  }
  car.driveUsage = rearDriveCap > 0 ? Math.min(1, Math.abs(fxRear) / rearDriveCap) : 0;

  // ── Lateral (slip angles → Pacejka) ──
  const vxs = Math.max(Math.abs(car.vx), 2.5) * (car.vx < 0 ? -1 : 1);
  const alphaF = Math.atan2(car.vy + a * car.r, Math.abs(vxs)) - car.steer * Math.sign(vxs);
  const alphaR = Math.atan2(car.vy - b * car.r, Math.abs(vxs));
  car.frontSlip = alphaF;
  car.rearSlip = alphaR;
  const fyF = lateralForce(alphaF, fzF, fxFront, p.frontTire, mu);
  let fyR = lateralForce(alphaR, fzR, fxRear, p.rearTire, mu * car.rearMuScale);
  if (drifting) {
    fyR *= p.handbrakeLateral;
    // The tap kicks the tail out toward the outside of the turn.
    if (!car.hbPrev && Math.abs(input.steer) > 0.1) {
      const kick = Math.min(1, Math.abs(car.vx) / 15) * DRIFT_KICK;
      car.r += (input.steer > 0 ? -1 : 1) * kick;
    }
  }
  car.hbPrev = drifting;

  // Body-frame forces (front forces rotated by steer angle).
  const cs = Math.cos(car.steer);
  const sn = Math.sin(car.steer);
  const drag = dragForce(car.vx);
  const fx = fxRear + fxFront * cs - fyF * sn - drag - car.extraDrag * car.vx;
  const fy = fyR + fyF * cs + fxFront * sn - car.extraDrag * car.vy;
  const mz = a * (fyF * cs + fxFront * sn) - b * fyR;

  const axBody = fx / m;
  const ayBody = fy / m;
  car.vx += (axBody + car.vy * car.r) * dt;
  car.vy += (ayBody - car.vx * car.r) * dt;
  car.r += (mz / p.izz) * dt;
  // Forgiving slides: gently damp yaw while drifting so the slide can be
  // held and caught without constant counter-steer.
  if (drifting) car.r -= car.r * Math.min(1, DRIFT_YAW_DAMP * dt);
  car.ax = axBody;
  car.ay = ayBody;

  // Low speed: blend toward the kinematic bicycle so the car doesn't
  // jitter or spin in place when (almost) stopped.
  const blend = clamp((3 - speed) / 3, 0, 1);
  if (blend > 0) {
    const rKin = (car.vx * Math.tan(car.steer)) / p.wheelbaseM;
    car.r += (rKin - car.r) * blend * Math.min(1, dt * 20);
    car.vy -= car.vy * blend * Math.min(1, dt * 10);
  }
  // No creeping when idle.
  if (input.throttle === 0 && input.brake === 0 && speed < 0.25) {
    car.vx = 0;
    car.vy = 0;
    car.r = 0;
  }

  car.heading += car.r * dt;
  const ch = Math.cos(car.heading);
  const sh = Math.sin(car.heading);
  car.x += (car.vx * ch - car.vy * sh) * dt;
  car.y += (car.vx * sh + car.vy * ch) * dt;
}

/** Drift angle (rad): angle between heading and velocity. */
export function driftAngle(car: KartCar): number {
  if (Math.abs(car.vx) < 1 && Math.abs(car.vy) < 1) return 0;
  return Math.atan2(car.vy, Math.abs(car.vx));
}
