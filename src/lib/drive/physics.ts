import {
  isOnTrack,
  projectOnRibbon,
  type RibbonHit,
} from "@/lib/drive/ribbon";
import type { DriveCarState, DriveInputs, DrivePoint } from "@/lib/drive/types";

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
  /** Slip bleed when grip exceeded. */
  slipGain: 0.55,
  slipDecay: 3.2,
  /** Minimum forward crawl when throttling off-track so the car never sticks. */
  offThrottleCrawl: 2.2,
} as const;

export function stepCar(
  car: DriveCarState,
  inputs: DriveInputs,
  dt: number,
  centerline: DrivePoint[],
  halfWidthM: number,
): { car: DriveCarState; hit: RibbonHit } {
  const hit = projectOnRibbon(centerline, car.x, car.y);
  const onTrack = isOnTrack(hit, halfWidthM);
  const p = DRIVE_PHYSICS;

  const throttle = Math.max(0, Math.min(1, inputs.throttle));
  const brake = Math.max(0, Math.min(1, inputs.brake));
  const steer = Math.max(-1, Math.min(1, inputs.steer));

  const speedFactor = Math.min(1, Math.abs(car.speed) / p.maxSpeedOn);
  const steerRate =
    p.steerRateLow * (1 - speedFactor) + p.steerRateHigh * speedFactor;

  let heading = car.heading + steer * steerRate * dt;
  // wrap
  if (heading > Math.PI) heading -= Math.PI * 2;
  if (heading < -Math.PI) heading += Math.PI * 2;

  const maxSpeed = onTrack ? p.maxSpeedOn : p.maxSpeedOff;
  let speed = car.speed;
  if (brake > 0.05) {
    speed -= p.brake * brake * dt;
  } else if (throttle > 0.05) {
    const headroom = Math.max(0, maxSpeed - Math.max(0, speed));
    const pull =
      p.accel * throttle * (0.35 + 0.65 * (headroom / Math.max(0.001, maxSpeed)));
    speed += pull * dt;
    // Guarantee a crawl off-track so releasing then re-throttling always moves.
    if (!onTrack && speed >= 0 && speed < p.offThrottleCrawl * throttle) {
      speed = p.offThrottleCrawl * throttle;
    }
  } else {
    const drag = onTrack ? p.coastDrag : p.offDrag;
    if (speed > 0) speed = Math.max(0, speed - drag * dt);
    else if (speed < 0) speed = Math.min(0, speed + drag * dt);
  }

  if (speed > maxSpeed) speed = maxSpeed;
  if (speed < -8) speed = -8;

  // Lateral grip / slide
  const grip = onTrack ? p.gripOn : p.gripOff;
  const yawRate = steer * steerRate;
  const demandedLat = Math.abs(speed) * Math.abs(yawRate);
  let slip = car.slip;
  if (demandedLat > grip) {
    slip += (demandedLat - grip) * p.slipGain * dt * Math.sign(steer || slip || 1);
  }
  slip *= Math.exp(-p.slipDecay * dt);
  if (Math.abs(slip) < 0.02) slip = 0;
  // Speed bleed when sliding / off track
  if (Math.abs(slip) > 0.4) {
    speed *= Math.exp(-0.35 * Math.abs(slip) * dt);
  }
  // Grass decay only while coasting — never pin a throttling car at 0.
  if (!onTrack && throttle < 0.05) {
    speed *= Math.exp(-p.offCoastDecay * dt);
  }
  // Final off-track crawl floor after drag/slip so the car never sticks at 0
  // mph on grass while the lap timer keeps running.
  if (!onTrack && throttle > 0.05 && brake < 0.05) {
    const floor = p.offThrottleCrawl * Math.min(1, throttle);
    if (speed >= 0 && speed < floor) speed = floor;
  }

  // Forward in east/north: heading 0 = +y (north), clockwise positive → +x east
  const fwdX = Math.sin(heading);
  const fwdY = Math.cos(heading);
  const latX = Math.cos(heading);
  const latY = -Math.sin(heading);

  const x = car.x + fwdX * speed * dt + latX * slip * dt;
  const y = car.y + fwdY * speed * dt + latY * slip * dt;

  return {
    car: { x, y, heading, speed, slip, onTrack },
    hit: { ...hit, onTrack },
  };
}

export function spawnAtStart(
  centerline: DrivePoint[],
  sfLocal: DrivePoint,
  headingRad: number,
): DriveCarState {
  // Place a few meters past SF along heading so first crossing counts a lap.
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
  };
}
