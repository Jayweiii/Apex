import { wrapAngle } from "./math";

/** Floating stick radius in CSS pixels. */
export const STICK_RADIUS = 72;
/** Fraction of the radius ignored around the centre. */
export const STICK_DEAD = 0.14;
/**
 * How far the stick's screen angle must swing before the camera reference
 * is taken again. Deliberately large (~60°). The 0.15 rad gate on the
 * classic kart re-latches on ordinary thumb noise, and because the chase
 * camera has already turned with the kart, that turns a held direction
 * back into a spin. A real re-aim (left to straight, or left to right)
 * still picks up the view you're looking at now.
 */
export const STICK_RELATCH = 1.05;

/** Camera yaw frozen for the current pull. `angle` is the stick's screen angle. */
export type AimLatch = {
  cam: number;
  /** null until the stick leaves the dead zone on this pull. */
  angle: number | null;
  /** True from engage (thumb-down / key / pad) until release. */
  engaged: boolean;
};

export function emptyAimLatch(cam = 0): AimLatch {
  return { cam, angle: null, engaged: false };
}

/** Latch the camera at the moment a pull starts. The first aim keeps this yaw. */
export function engageAim(latch: AimLatch, liveCam: number) {
  latch.cam = liveCam;
  latch.angle = null;
  latch.engaged = true;
}

export function releaseAim(latch: AimLatch) {
  latch.angle = null;
  latch.engaged = false;
}

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

const scratchCmd: StickCmd = { active: false, x: 0, y: 0, throttle: 0, heading: 0 };
const scratchClamp = { x: 0, y: 0 };

export function clampStick(
  dx: number,
  dy: number,
  r = STICK_RADIUS,
  out: { x: number; y: number } = scratchClamp,
): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len <= r || len === 0) {
    out.x = dx;
    out.y = dy;
    return out;
  }
  const k = r / len;
  out.x = dx * k;
  out.y = dy * k;
  return out;
}

/**
 * Write the stick command into `out` (no allocation). `camYaw` must be the
 * latched camera, not the live chase yaw, while a pull is held.
 */
export function stickCommand(
  dx: number,
  dy: number,
  camYaw: number,
  r = STICK_RADIUS,
  out: StickCmd = scratchCmd,
): StickCmd {
  const c = clampStick(dx, dy, r, scratchClamp);
  const nx = c.x / r;
  const ny = c.y / r;
  const mag = Math.hypot(nx, ny);
  if (mag <= STICK_DEAD) {
    out.active = false;
    out.x = 0;
    out.y = 0;
    out.throttle = 0;
    out.heading = camYaw;
    return out;
  }
  out.active = true;
  out.x = nx;
  out.y = ny;
  out.throttle = Math.min(1, (mag - STICK_DEAD) / (1 - STICK_DEAD));
  // atan2(right, up): up is 0, screen-right is +π/2, screen-left is −π/2.
  out.heading = wrapAngle(camYaw + Math.atan2(nx, -ny));
  return out;
}

/**
 * Update the latch for one sample. While the pull is engaged but still in
 * the dead zone, the thumb-down camera is kept. The first aimed angle does
 * not move that camera. Only a swing larger than `STICK_RELATCH` re-latches
 * onto `liveCam`.
 */
export function stepAimLatch(
  latch: AimLatch,
  liveCam: number,
  dx: number,
  dy: number,
  r = STICK_RADIUS,
) {
  if (!latch.engaged) {
    latch.angle = null;
    return;
  }
  const c = clampStick(dx, dy, r, scratchClamp);
  const nx = c.x / r;
  const ny = c.y / r;
  if (Math.hypot(nx, ny) <= STICK_DEAD) return;
  const ang = Math.atan2(nx, -ny);
  if (latch.angle === null) {
    latch.angle = ang;
    return;
  }
  if (Math.abs(wrapAngle(ang - latch.angle)) > STICK_RELATCH) {
    latch.cam = liveCam;
    latch.angle = ang;
  }
}

/**
 * Chase camera yaw. It follows the kart and leans a little into a slide.
 * The stick does not read this live value while a pull is held.
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
