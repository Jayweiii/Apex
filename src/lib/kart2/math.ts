export const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x < -Math.PI) x += TAU;
  return x;
}

export function lerpAngle(from: number, to: number, t: number): number {
  return wrapAngle(from + wrapAngle(to - from) * t);
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Positive when `to` is counter-clockwise of `from` (a left turn if heading grows clockwise). */
export function leftTurn(from: number, to: number): number {
  return wrapAngle(from - to);
}
