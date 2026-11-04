/**
 * Floating-joystick maths for Apex Kart (#51). Pure functions so the feel can
 * be unit-tested without a DOM.
 *
 * Offset (dx, dy) is in px from where the thumb landed; +x is right, +y is
 * down (screen space). Left/right steers the rear (drift angle), pulling down
 * gives throttle, releasing the stick brakes.
 */
export const STICK_RADIUS = 56;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD = 0.12;
/** Lateral pull (0..1) at/above which the stick counts as holding a drift. */
export const DRIFT_STEER = 0.7;
/** Minimum throttle for the drift-hold to engage. */
export const DRIFT_THROTTLE = 0.3;

/**
 * Throttle at which the countdown launch arms. Above the resting-thumb range
 * (a 5-10 px touch is <= ~0.07 throttle), below a deliberate pull.
 */
export const LAUNCH_ARM_THROTTLE = 0.18;

/**
 * Countdown launch arming. Returns the new "armed at" countdown time (-1 =
 * not armed). Arms on the first frame throttle reaches the threshold, keeps
 * that time while held (so it can't re-arm later in the window), and resets
 * when throttle drops below it.
 */
export function updateLaunchArm(armedAt: number, throttle: number, t: number): number {
  if (throttle < LAUNCH_ARM_THROTTLE) return -1;
  return armedAt < 0 ? t : armedAt;
}

/** Stick pull (fraction of radius, straight down) that yields throttle t. */
export function pullForThrottle(t: number): number {
  return STICK_DEAD + t * (1 - STICK_DEAD);
}

export interface StickOutput {
  /** −1 (left) … +1 (right): rear-end steer target. */
  steer: number;
  /** 0 … 1 */
  throttle: number;
  /** Hard sideways pull on throttle = hold the drift (mini-turbo charge). */
  handbrake: boolean;
}

function dead(v: number): number {
  const a = Math.abs(v);
  if (a <= STICK_DEAD) return 0;
  return Math.sign(v) * ((a - STICK_DEAD) / (1 - STICK_DEAD));
}

/** Clamp an offset to the stick radius (for drawing the knob). */
export function clampToRadius(dx: number, dy: number, r = STICK_RADIUS): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= r || len === 0) return { x: dx, y: dy };
  const k = r / len;
  return { x: dx * k, y: dy * k };
}

export function stickOutput(dx: number, dy: number, r = STICK_RADIUS): StickOutput {
  const c = clampToRadius(dx, dy, r);
  const steer = dead(c.x / r);
  // Up / centre = no throttle; down is linear past the dead zone so throttle
  // (and so drive force) scales directly with how far the stick is pulled.
  const throttle = Math.min(1, dead(Math.max(0, c.y / r)));
  return {
    steer,
    throttle,
    handbrake: Math.abs(steer) >= DRIFT_STEER && throttle >= DRIFT_THROTTLE,
  };
}
