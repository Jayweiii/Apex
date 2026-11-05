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
/** Steer gain: full steer lock at a heading error of 1 / this (rad). */
export const HEADING_GAIN = 2.5;

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
export function stickOutput(dx: number, dy: number, heading = 0, camRot = 0, r = STICK_RADIUS): StickOutput {
  const throttle = stickThrottle(dx, dy, r);
  if (throttle <= 0) return { steer: 0, throttle: 0, handbrake: false, target: null };
  const target = stickTargetHeading(dx, dy, camRot);
  const err = wrapAngle(target - heading); // + = target is to the left
  const steer = Math.max(-1, Math.min(1, -err * HEADING_GAIN));
  return {
    steer,
    throttle,
    handbrake: Math.abs(err) >= DRIFT_HEADING_ERR && throttle >= DRIFT_THROTTLE,
    target,
  };
}
