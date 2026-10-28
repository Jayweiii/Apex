import {
  heightAtAlong,
  sampleGrade,
  type TrackGradeSample,
} from "@/lib/drive/elevation";
import { projectOnRibbon, type RibbonHit } from "@/lib/drive/ribbon";
import type { DriveCarPreset } from "@/lib/drive/cars";
import type {
  DriveCarState,
  DriveInputs,
  DrivePoint,
  DriveSurface,
} from "@/lib/drive/types";

/** Arcade tuning — fun on phone, with load-sensitive tires. */
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
  /** Max lateral grip on asphalt (m/s²) at nominal load. */
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
  // —— Vehicle geometry (Miata-ish) ——
  massKg: 1080,
  wheelbaseM: 2.275,
  trackWidthM: 1.41,
  cgHeightM: 0.48,
  /** Static front weight fraction. */
  staticFrontFrac: 0.52,
  /** Spring travel visual scale (m at 1g static). */
  springTravelM: 0.065,
  damperRate: 14,
  /** Pacejka-ish shape coeffs. */
  pacejkaB: 12,
  pacejkaC: 1.35,
  pacejkaE: 0.95,
  /** Friction ellipse long/lat coupling. */
  ellipseCoupling: 0.92,
  g: 9.81,
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
  /** Optional precomputed grade/banking samples aligned to centerline. */
  grades?: TrackGradeSample[];
};

/**
 * Simplified Pacejka pure-slip factor in [0, ~1.05].
 * kappa is normalized slip demand (0 = none, 1 = peak neighborhood).
 */
export function pacejkaFactor(kappa: number): number {
  const B = DRIVE_PHYSICS.pacejkaB;
  const C = DRIVE_PHYSICS.pacejkaC;
  const E = DRIVE_PHYSICS.pacejkaE;
  const x = Math.max(0, kappa);
  return Math.sin(C * Math.atan(B * x - E * (B * x - Math.atan(B * x))));
}

/** Load-sensitive peak lateral accel (m/s²) for one tire share. */
function loadSensitiveMu(
  baseGrip: number,
  normalN: number,
  massKg: number,
): number {
  const staticN = (massKg * DRIVE_PHYSICS.g) / 4;
  const loadRatio = Math.max(0.15, normalN / Math.max(1, staticN));
  const scale = Math.pow(loadRatio, 0.85) / loadRatio;
  return baseGrip * scale * loadRatio;
}

function wheelNormals(opts: {
  massKg: number;
  longAccel: number;
  latAccel: number;
  grade: number;
  bank: number;
  frontFrac: number;
}): [number, number, number, number] {
  const p = DRIVE_PHYSICS;
  const W = opts.massKg * p.g;
  const gLong = -opts.grade * p.g;
  const gLat = Math.sin(opts.bank) * p.g;
  const aLong = opts.longAccel + gLong;
  const aLat = opts.latAccel + gLat;

  const front = opts.frontFrac;
  const rear = 1 - front;
  let fl = W * front * 0.5;
  let fr = W * front * 0.5;
  let rl = W * rear * 0.5;
  let rr = W * rear * 0.5;

  const dLong = (opts.massKg * aLong * p.cgHeightM) / p.wheelbaseM;
  fl += dLong * 0.5;
  fr += dLong * 0.5;
  rl -= dLong * 0.5;
  rr -= dLong * 0.5;

  const dLat = (opts.massKg * aLat * p.cgHeightM) / p.trackWidthM;
  fl -= dLat * 0.5;
  rl -= dLat * 0.5;
  fr += dLat * 0.5;
  rr += dLat * 0.5;

  const clamp = (n: number) => Math.max(0, n);
  return [clamp(fl), clamp(fr), clamp(rl), clamp(rr)];
}

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
  const gradeSample = opts?.grades
    ? sampleGrade(opts.grades, hit.segIndex)
    : { grade: 0, bank: 0, z: heightAtAlong(centerline, hit.along) };

  const throttleTarget = Math.max(0, Math.min(1, inputs.throttle));
  const brakeTarget = Math.max(0, Math.min(1, inputs.brake));
  const steer = Math.max(-1, Math.min(1, inputs.steer));

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

  const yawRate = steer * steerRate * turnIn;
  const latAccelDemand = car.speed * yawRate;

  const wheels = wheelNormals({
    massKg: p.massKg,
    longAccel,
    latAccel: latAccelDemand,
    grade: gradeSample.grade,
    bank: gradeSample.bank,
    frontFrac: p.staticFrontFrac,
  });

  const maxSpeed =
    surface === "grass" ? p.maxSpeedOff : p.maxSpeedOn * topMul;
  let speed = car.speed;
  if (brakePedal > 0.05) {
    const bite = 0.75 + 0.35 * Math.min(1, Math.abs(speed) / 20);
    speed -= p.brake * brakeMul * brakePedal * bite * dt;
  } else if (throttle > 0.05) {
    const headroom = Math.max(0, maxSpeed - Math.max(0, speed));
    const pull =
      p.accel *
      powerMul *
      throttle *
      (0.28 + 0.72 * (headroom / Math.max(0.001, maxSpeed)));
    const putDown = 1 + Math.max(0, load) * 0.15;
    const gradeAssist = -gradeSample.grade * p.g * 0.55;
    speed += (pull * putDown + gradeAssist) * dt;
    if (
      surface === "grass" &&
      speed >= 0 &&
      speed < p.offThrottleCrawl * throttle
    ) {
      speed = p.offThrottleCrawl * throttle;
    }
  } else {
    const drag =
      surface === "grass"
        ? p.offDrag
        : surface === "curb"
          ? p.coastDrag + p.curbDrag
          : p.coastDrag;
    speed += -gradeSample.grade * p.g * 0.85 * dt;
    if (speed > 0) speed = Math.max(0, speed - drag * dt);
    else if (speed < 0) speed = Math.min(0, speed + drag * dt);
  }

  if (speed > maxSpeed) speed = maxSpeed;
  if (speed < -8) speed = -8;

  let gripBase =
    surface === "grass"
      ? p.gripOff
      : surface === "curb"
        ? p.gripCurb
        : p.gripOn;
  gripBase *= gripMul;

  const tireGrips = wheels.map((n) =>
    loadSensitiveMu(gripBase, n, p.massKg),
  );
  const meanGrip =
    (tireGrips[0]! + tireGrips[1]! + tireGrips[2]! + tireGrips[3]!) / 4;
  const longDemand = Math.abs(longAccel);
  const latDemand = Math.abs(latAccelDemand);
  const kappa =
    meanGrip > 1e-3
      ? Math.hypot(longDemand / meanGrip, latDemand / meanGrip)
      : 0;
  const pac = pacejkaFactor(Math.min(2.2, kappa));
  const ellipse =
    meanGrip > 1e-3
      ? Math.hypot(
          (longDemand / meanGrip) * p.ellipseCoupling,
          latDemand / meanGrip,
        )
      : 0;
  const grip =
    meanGrip *
    (1 - Math.max(0, brakePedal) * 0.12 + Math.max(0, load) * 0.06) *
    Math.max(0.35, pac);

  let slip = car.slip;
  const demandedLat = Math.abs(speed) * Math.abs(yawRate);
  if (demandedLat > grip || ellipse > 1) {
    const over =
      Math.max(0, demandedLat - grip) + Math.max(0, ellipse - 1) * grip * 0.5;
    slip += over * p.slipGain * dt * Math.sign(steer || slip || 1);
  }
  if (surface === "curb" && Math.abs(speed) > 4) {
    slip +=
      Math.sin(performanceNowProxy() * 0.09 + hit.along) *
      p.curbRumble *
      dt *
      18;
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
  if (surface === "curb" && Math.abs(speed) > 8) {
    const toward = -Math.sign(hit.lateral || 1);
    x += latX * toward * 0.15 * dt * Math.abs(speed) * 0.02;
    y += latY * toward * 0.15 * dt * Math.abs(speed) * 0.02;
  }

  const z = heightAtAlong(centerline, hit.along) + 0.02;

  const staticN = (p.massKg * p.g) / 4;
  const travelTarget = wheels.map(
    (n) => (n / staticN - 1) * p.springTravelM,
  ) as [number, number, number, number];
  const prevTravel = car.wheelTravel ?? [0, 0, 0, 0];
  const wheelTravel = prevTravel.map((t, i) => {
    const err = travelTarget[i]! - t;
    return t + err * Math.min(1, p.damperRate * dt);
  }) as [number, number, number, number];

  const frontAvg = (wheelTravel[0]! + wheelTravel[1]!) * 0.5;
  const rearAvg = (wheelTravel[2]! + wheelTravel[3]!) * 0.5;
  const leftAvg = (wheelTravel[0]! + wheelTravel[2]!) * 0.5;
  const rightAvg = (wheelTravel[1]! + wheelTravel[3]!) * 0.5;
  let pitch = (rearAvg - frontAvg) / (p.wheelbaseM * 0.5);
  let roll = (rightAvg - leftAvg) / (p.trackWidthM * 0.5);
  roll += gradeSample.bank * 0.65;
  pitch += Math.atan(gradeSample.grade) * 0.35;
  pitch = Math.max(-0.22, Math.min(0.22, pitch));
  roll = Math.max(-0.28, Math.min(0.28, roll));

  const prevPitch = car.pitch ?? 0;
  const prevRoll = car.roll ?? 0;
  pitch = prevPitch + (pitch - prevPitch) * Math.min(1, 10 * dt);
  roll = prevRoll + (roll - prevRoll) * Math.min(1, 10 * dt);

  return {
    car: {
      x,
      y,
      z,
      heading,
      speed,
      slip,
      onTrack,
      surface,
      throttlePedal: throttle,
      brakePedal,
      load,
      pitch,
      roll,
      wheelTravel,
      wheelLoadN: wheels,
      longAccel,
      latAccel: latAccelDemand,
    },
    hit: { ...hit, onTrack },
    surface,
  };
}

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
  const hit0 = projectOnRibbon(centerline, x, y);
  const frontShare =
    (DRIVE_PHYSICS.massKg * DRIVE_PHYSICS.g * DRIVE_PHYSICS.staticFrontFrac) /
    2;
  const rearShare =
    (DRIVE_PHYSICS.massKg *
      DRIVE_PHYSICS.g *
      (1 - DRIVE_PHYSICS.staticFrontFrac)) /
    2;
  return {
    x,
    y,
    z: heightAtAlong(centerline, hit0.along),
    heading: headingRad,
    speed: 0,
    slip: 0,
    onTrack: true,
    surface: "asphalt",
    throttlePedal: 0,
    brakePedal: 0,
    load: 0,
    pitch: 0,
    roll: 0,
    wheelTravel: [0, 0, 0, 0],
    wheelLoadN: [frontShare, frontShare, rearShare, rearShare],
    longAccel: 0,
    latAccel: 0,
  };
}
