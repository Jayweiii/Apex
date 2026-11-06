/**
 * Floating-joystick maths for Apex Kart (#51). Pure functions so the feel can
 * be unit-tested without a DOM.
 *
 * Offset (dx, dy) is in px from where the thumb landed; +x is right, +y is
 * down (screen space). Direction-based: the stick ANGLE is the heading the
 * kart should face (screen "up" = the camera's forward direction), the stick
 * DISTANCE is the throttle, and releasing the stick brakes. The kart only ever
 * drives forward.
 */
export const STICK_RADIUS = 56;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD = 0.12;
/** Minimum throttle for the drift-hold to engage. */
export const DRIFT_THROTTLE = 0.3;
/** Heading error (rad) at/above which a sharp turn holds the drift. */
export const DRIFT_HEADING_ERR = 1;
/** At/above this error (rad) the drift hold lets go so a near-U-turn can finish. */
export const DRIFT_HEADING_MAX = 2.5;
/**
 * Steer gain: full steer lock at a heading error of 1 / this (rad). Kept low:
 * with the steer slew + tyre lag, 2.5 put the loop into a limit cycle that
 * never settled on a 90° aim.
 */
export const HEADING_GAIN = 0.8;
/** Steer backed off per rad/s of yaw rate (damps overshoot / spin-out). */
export const YAW_DAMP = 0.4;
/**
 * Max angle (rad) the steer may lead the velocity direction. Beyond it the kart
 * turns faster than the tyres can bend its path, the nose swings past the
 * travel direction and body vx goes negative (a backwards slide). Capping the
 * lead keeps vx = |v|·cos(slip) > 0 for any aim, up to a full U-turn.
 */
export const MAX_SLIP_LEAD = 0.9;

export interface StickOutput {
  /** −1 (left) … +1 (right): rear-end steer toward the target heading. */
  steer: number;
  /** 0 … 1: stick distance past the dead zone, linear. */
  throttle: number;
  /** Sharp heading change on throttle = hold the drift (mini-turbo charge). */
  handbrake: boolean;
  /** World heading (rad, 0 = +x, CCW +) the stick points at; null in the dead zone. */
  target: number | null;
}

export function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r < -Math.PI) r += 2 * Math.PI;
  return r;
}

/** Clamp an offset to the stick radius (for drawing the knob). */
export function clampToRadius(dx: number, dy: number, r = STICK_RADIUS): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= r || len === 0) return { x: dx, y: dy };
  const k = r / len;
  return { x: dx * k, y: dy * k };
}

/** Stick distance past the dead zone, 0..1, linear. */
export function stickThrottle(dx: number, dy: number, r = STICK_RADIUS): number {
  const c = clampToRadius(dx, dy, r);
  const d = Math.hypot(c.x, c.y) / r;
  return d <= STICK_DEAD ? 0 : Math.min(1, (d - STICK_DEAD) / (1 - STICK_DEAD));
}

/**
 * Screen-space stick offset → world heading. Screen "up" is world angle
 * `camRot` (the heading-up camera); screen "left" is camRot + 90° (CCW).
 */
export function stickTargetHeading(dx: number, dy: number, camRot: number): number {
  return wrapAngle(camRot + Math.atan2(-dx, -dy));
}

/**
 * @param heading current kart heading (world rad)
 * @param camRot  world angle that points to screen-up (camera rotation)
 */
export function stickOutput(
  dx: number,
  dy: number,
  heading = 0,
  camRot = 0,
  r = STICK_RADIUS,
  yawRate = 0,
  vx = 0,
  vy = 0,
): StickOutput {
  const throttle = stickThrottle(dx, dy, r);
  if (throttle <= 0) return { steer: 0, throttle: 0, handbrake: false, target: null };
  const target = stickTargetHeading(dx, dy, camRot);
  let err = wrapAngle(target - heading); // + = target is to the left
  // Velocity direction relative to the nose (+ = travelling to the left). Don't
  // aim the nose further than MAX_SLIP_LEAD past it: let the path catch up.
  if (Math.hypot(vx, vy) > 1) {
    const slip = Math.atan2(vy, vx);
    const lead = Math.max(-MAX_SLIP_LEAD, Math.min(MAX_SLIP_LEAD, wrapAngle(err - slip)));
    err = slip + lead;
  }
  // PD: the yaw-rate term (+ = turning left) backs off the steer as the nose
  // swings in, so the kart stops on the target instead of spinning past it
  // and sliding backwards.
  const steer = Math.max(-1, Math.min(1, -err * HEADING_GAIN + yawRate * YAW_DAMP));
  return {
    steer,
    throttle,
    // The stick never holds the handbrake itself: a held drift pinned the
    // heading short of (or past) the target. Drift is the explicit Space key.
    handbrake: false,
    target,
  };
}
