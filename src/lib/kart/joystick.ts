/**
 * Floating joystick maths (#51). Pure so it can be unit-tested without a DOM.
 *
 * The stick base is wherever the thumb landed. Left/right offset steers the
 * rear end (drift angle); pulling down gives throttle. Releasing brakes.
 */
export const STICK_RADIUS = 56; // px
export const STEER_DEADZONE = 0.08;
export const THROTTLE_DEADZONE = 0.12;

export interface StickReading {
  /** Knob offset from the base, clamped to the radius (px). */
  knobX: number;
  knobY: number;
  /** -1 (left) … 1 (right). */
  steer: number;
  /** 0 … 1, more as the thumb pulls down. */
  throttle: number;
}

function deadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * ((a - dz) / (1 - dz));
}

export function readStick(dx: number, dy: number, radius = STICK_RADIUS): StickReading {
  const len = Math.hypot(dx, dy);
  const k = len > radius ? radius / len : 1;
  const knobX = dx * k;
  const knobY = dy * k;
  const steer = deadzone(knobX / radius, STEER_DEADZONE);
  // Down is +y on screen. Up/centre = coast (no throttle).
  const pull = Math.max(0, deadzone(knobY / radius, THROTTLE_DEADZONE));
  // Gentle curve: fine control near the top, full throttle at the bottom.
  const throttle = Math.min(1, pull ** 0.8);
  return { knobX, knobY, steer, throttle };
}
