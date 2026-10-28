import { projectOnRibbon, type RibbonHit } from "@/lib/drive/ribbon";
import type { DriveCarPreset } from "@/lib/drive/cars";
import type {
  DriveCarState,
  DriveInputs,
  DrivePoint,
  DriveSurface,
} from "@/lib/drive/types";

/** Arcade tuning — fun on phone, not a sim. */
export const DRIVE_PHYSICS = {
  maxSpeedOn: 52, // m/s ≈ 116 mph
  /** Grass hard-cap (~9 mph) — cutting is punishing. */
  maxSpeedOff: 4,
  accel: 14,
  brake: 22,
  coastDrag: 1.8,
  /** Strong grass drag so throttle-off dumps speed immediately. */
  offDrag: 36,
  /** Extra continuous grass decay while coasting (not while throttling). */
  offCoastDecay: 2.4,
  /** Steer rate at low speed (rad/s at full lock). */
  steerRateLow: 2.8,
  /** Steer rate at high speed. */
  steerRateHigh: 1.15,
  /** Max lateral grip on asphalt (m/s²). */
  gripOn: 11,
  /** Max lateral grip on grass. */
  gripOff: 4.5,
  /** Curb / rumble strip grip (a bit lively). */
  gripCurb: 9.2,
  /** Slip bleed when grip exceeded. */
  slipGain: 0.55,
  slipDecay: 3.2,
  /** Minimum forward crawl when throttling off-track so the car never sticks. */
  offThrottleCrawl: 2.2,
  /** Fraction of half-width where curb/rumble begins. */
  curbStartFrac: 0.78,
  /** Weight-transfer pitch response (dimensionless). */
  weightTransfer: 0.42,
  /** Throttle response lag (1/s) — higher = snappier. */
  throttleLag: 4.5,
  /** Brake response lag (1/s). */
  brakeLag: 6.5,
  /** Extra drag while on curb. */
  curbDrag: 3.8,
  /** Small curb bounce lateral noise scale. */
  curbRumble: 0.55,
} as const;

export function surfaceForHit(
  hit: RibbonHit,
  halfWidthM: number,
): DriveSurface {
  const abs = Math.abs(hit.lateral);
  if (abs > halfWidthM) return "grass";
  if (abs >= halfWidthM * DRIVE_PHYSICS.curbStartFrac) return "curb";
  return "asphalt";
}

export type StepCarOpts = {
  carPreset?: DriveCarPreset;
};

export function stepCar(
  car: DriveCarState,
  inputs: DriveInputs,
  dt: number,
  centerline: DrivePoint[],
  halfWidthM: number,
  opts?: StepCarOpts,
): { car: DriveCarState; hit: RibbonHit; surface: DriveSurface } {
  const hit = projectOnRibbon(centerline, car.x, car.y);
  const surface = surfaceForHit(hit, halfWidthM);
  const onTrack = surface !== "grass";
  const p = DRIVE_PHYSICS;
  const preset = opts?.carPreset;

  const throttleTarget = Math.max(0, Math.min(1, inputs.throttle));
  const brakeTarget = Math.max(0, Math.min(1, inputs.brake));
  const steer = Math.max(-1, Math.min(1, inputs.steer));

  // Pedal feel — lag so throttle/brake aren't binary teleports.
  let throttle = car.throttlePedal ?? 0;
  let brakePedal = car.brakePedal ?? 0;
  throttle += (throttleTarget - throttle) * Math.min(1, p.throttleLag * dt);
  brakePedal += (brakeTarget - brakePedal) * Math.min(1, p.brakeLag * dt);

  const powerMul = preset?.power ?? 1;
  const brakeMul = preset?.brake ?? 1;
  const gripMul = preset?.grip ?? 1;
  const steerMul = preset?.steer ?? 1;
  const topMul = preset?.topSpeed ?? 1;

  const speedFactor = Math.min(1, Math.abs(car.speed) / (p.maxSpeedOn * topMul));
  const steerRate =
    (p.steerRateLow * (1 - speedFactor) + p.steerRateHigh * speedFactor) *
    steerMul;

  // Weight transfer: accel loads rear (more exit grip / less turn-in),
  // braking loads front (more turn-in, easier lock-up feel via slip).
  const longAccel =
    (throttle * p.accel * powerMul - brakePedal * p.brake * brakeMul) *
    (car.speed >= 0 ? 1 : -1);
  let load = car.load ?? 0;
  const targetLoad = Math.max(
    -1,
    Math.min(1, (longAccel / 36) * p.weightTransfer),
  );
  load += (targetLoad - load) * Math.min(1, 7 * dt);

  const turnIn = 1 + Math.max(0, -load) * 0.22 - Math.max(0, load) * 0.12;
  let heading = car.heading + steer * steerRate * turnIn * dt;
  if (heading > Math.PI) heading -= Math.PI * 2;
  if (heading < -Math.PI) heading += Math.PI * 2;

  const maxSpeed =
    surface === "grass" ? p.maxSpeedOff : p.maxSpeedOn * topMul;
  let speed = car.speed;
  if (brakePedal > 0.05) {
    // Brake feel: stronger initially, softens as speed drops (trail-brake).
    const bite = 0.75 + 0.35 * Math.min(1, Math.abs(speed) / 20);
    speed -= p.brake * brakeMul * brakePedal * bite * dt;
  } else if (throttle > 0.05) {
    const headroom = Math.max(0, maxSpeed - Math.max(0, speed));
    // Power delivery: stronger mid-range, softer near redline.
    const pull =
      p.accel *
      powerMul *
      throttle *
      (0.28 + 0.72 * (headroom / Math.max(0.001, maxSpeed)));
    // Rear load helps put power down.
    const putDown = 1 + Math.max(0, load) * 0.15;
    speed += pull * putDown * dt;
    if (surface === "grass" && speed >= 0 && speed < p.offThrottleCrawl * throttle) {
      speed = p.offThrottleCrawl * throttle;
    }
  } else {
    const drag =
      surface === "grass"
        ? p.offDrag
        : surface === "curb"
          ? p.coastDrag + p.curbDrag
          : p.coastDrag;
    if (speed > 0) speed = Math.max(0, speed - drag * dt);
    else if (speed < 0) speed = Math.min(0, speed + drag * dt);
  }

  if (speed > maxSpeed) speed = maxSpeed;
  if (speed < -8) speed = -8;

  // Lateral grip by surface + weight transfer
  let gripBase =
    surface === "grass"
      ? p.gripOff
      : surface === "curb"
        ? p.gripCurb
        : p.gripOn;
  gripBase *= gripMul;
  // Braking reduces rear grip a touch; throttle reduces front (oversteer/understeer arcade).
  const grip =
    gripBase *
    (1 - Math.max(0, brakePedal) * 0.12 + Math.max(0, load) * 0.06);

  const yawRate = steer * steerRate * turnIn;
  const demandedLat = Math.abs(speed) * Math.abs(yawRate);
  let slip = car.slip;
  if (demandedLat > grip) {
    slip +=
      (demandedLat - grip) * p.slipGain * dt * Math.sign(steer || slip || 1);
  }
  // Curb adds high-frequency slip jitter (rumble strip feel).
  if (surface === "curb" && Math.abs(speed) > 4) {
    slip += Math.sin(performanceNowProxy() * 0.09 + hit.along) * p.curbRumble * dt * 18;
  }
  slip *= Math.exp(-p.slipDecay * dt);
  if (Math.abs(slip) < 0.02) slip = 0;
  if (Math.abs(slip) > 0.4) {
    speed *= Math.exp(-0.35 * Math.abs(slip) * dt);
  }
  if (surface === "grass" && throttle < 0.05) {
    speed *= Math.exp(-p.offCoastDecay * dt);
  }
  if (surface === "grass" && throttle > 0.05 && brakePedal < 0.05) {
    const floor = p.offThrottleCrawl * Math.min(1, throttle);
    if (speed >= 0 && speed < floor) speed = floor;
  }

  const fwdX = Math.sin(heading);
  const fwdY = Math.cos(heading);
  const latX = Math.cos(heading);
  const latY = -Math.sin(heading);

  let x = car.x + fwdX * speed * dt + latX * slip * dt;
  let y = car.y + fwdY * speed * dt + latY * slip * dt;
  // Mild curb bounce toward centerline when riding the strip hard.
  if (surface === "curb" && Math.abs(speed) > 8) {
    const toward = -Math.sign(hit.lateral || 1);
    x += latX * toward * 0.15 * dt * Math.abs(speed) * 0.02;
    y += latY * toward * 0.15 * dt * Math.abs(speed) * 0.02;
  }

  return {
    car: {
      x,
      y,
      heading,
      speed,
      slip,
      onTrack,
      surface,
      throttlePedal: throttle,
      brakePedal,
      load,
    },
    hit: { ...hit, onTrack },
    surface,
  };
}

/** performance.now for rumble phase; safe under Node verify scripts. */
function performanceNowProxy(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export function spawnAtStart(
  centerline: DrivePoint[],
  sfLocal: DrivePoint,
  headingRad: number,
): DriveCarState {
  const nest = 6;
  let x = sfLocal.x + Math.sin(headingRad) * nest;
  let y = sfLocal.y + Math.cos(headingRad) * nest;
  if (centerline.length >= 2) {
    const hit = projectOnRibbon(centerline, x, y);
    const seg = centerline[hit.segIndex]!;
    const next = centerline[Math.min(centerline.length - 1, hit.segIndex + 1)]!;
    const dx = next.x - seg.x;
    const dy = next.y - seg.y;
    const len = Math.hypot(dx, dy) || 1;
    x = seg.x + (dx / len) * 8;
    y = seg.y + (dy / len) * 8;
    headingRad = Math.atan2(dx, dy);
  }
  return {
    x,
    y,
    heading: headingRad,
    speed: 0,
    slip: 0,
    onTrack: true,
    surface: "asphalt",
    throttlePedal: 0,
    brakePedal: 0,
    load: 0,
  };
}
