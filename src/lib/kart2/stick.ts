import { wrapAngle } from "./math";

/** Floating stick radius in CSS pixels. */
export const STICK_RADIUS = 72;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD = 0.14;

export type StickCmd = {
  /** False when the stick is released or inside the dead zone (that brakes). */
  active: boolean;
  /** −1..1, screen right. */
  x: number;
  /** −1..1, screen down. */
  y: number;
  /** 0..1, how far the stick is pushed. */
  throttle: number;
  /**
   * World heading the kart should face. 0 is north, positive is clockwise,
   * so screen-left (relative to `camYaw`) is `camYaw − π/2`.
   */
  heading: number;
};

export function clampStick(
  dx: number,
  dy: number,
  r = STICK_RADIUS,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= r || len === 0) return { x: dx, y: dy };
  const k = r / len;
  return { x: dx * k, y: dy * k };
}

/**
 * The stick directly commands heading in camera space.
 * `dx`/`dy` are pixels from where the thumb landed (+x right, +y down).
 * Pushing the stick left faces the kart screen-left; how far it is pushed
 * is the throttle. The centre (and a released stick) is not active.
 */
export function stickCommand(
  dx: number,
  dy: number,
  camYaw: number,
  r = STICK_RADIUS,
): StickCmd {
  const c = clampStick(dx, dy, r);
  const nx = c.x / r;
  const ny = c.y / r;
  const mag = Math.hypot(nx, ny);
  if (mag <= STICK_DEAD) {
    return { active: false, x: 0, y: 0, throttle: 0, heading: camYaw };
  }
  const throttle = Math.min(1, (mag - STICK_DEAD) / (1 - STICK_DEAD));
  // atan2(right, up): up is 0, screen-right is +π/2, screen-left is −π/2.
  const heading = wrapAngle(camYaw + Math.atan2(nx, -ny));
  return { active: true, x: nx, y: ny, throttle, heading };
}

/**
 * Chase camera yaw. It follows the kart and leans a little into a slide,
 * so "stick left" stays "turn left" as the view swings around.
 */
export function chaseCamYaw(
  cam: number,
  heading: number,
  slip: number,
  dt: number,
): number {
  const lean = Math.max(-0.55, Math.min(0.55, slip)) * 0.4;
  const target = wrapAngle(heading + lean);
  const k = 1 - Math.exp(-5.2 * dt);
  const step = wrapAngle(target - cam) * k;
  return wrapAngle(cam + step);
}
