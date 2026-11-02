/**
 * Headless driver for tests and difficulty tuning (spec phase 5): pure
 * pursuit on the centerline plus a curvature-based speed target.
 * Deterministic and allocation-free.
 */
import { GRAVITY } from "./car";
import type { KartInput, KartWorld } from "./sim";

export type BotStyle = {
  /** Points (~2 m) ahead to aim at. */
  lookahead: number;
  /** Fraction of the theoretical corner speed to target (0…1+). */
  aggression: number;
  /** Lateral offset from the centerline to drive at (m, + = left). */
  offset: number;
};

export const DEFAULT_BOT: BotStyle = { lookahead: 7, aggression: 0.8, offset: 0 };

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function botInput(world: KartWorld, input: KartInput, style: BotStyle = DEFAULT_BOT): void {
  const t = world.track;
  const c = world.car;
  const n = t.count;
  // Look further ahead at speed (≈0.45 s), like a driver's eyes.
  const sp = Math.hypot(c.vx, c.vy);
  const ahead = (world.hit.index + style.lookahead + Math.round(sp * 0.22)) % n;
  const ax = t.px[ahead] - t.ty[ahead] * style.offset;
  const ay = t.py[ahead] + t.tx[ahead] * style.offset;
  const err = wrapAngle(Math.atan2(ay - c.y, ax - c.x) - c.heading);
  input.steer = Math.max(-1, Math.min(1, -err * 1.6 + c.r * 0.08));

  // Tightest curvature over the next ~50 m sets the target speed.
  let maxCurv = 0;
  for (let k = 4; k <= 26; k += 2) {
    const i0 = (world.hit.index + k) % n;
    const i1 = (i0 + 4) % n;
    const dh = Math.abs(wrapAngle(Math.atan2(t.ty[i1], t.tx[i1]) - Math.atan2(t.ty[i0], t.tx[i0])));
    const ds = 8; // 4 points × 2 m
    const curv = dh / ds;
    if (curv > maxCurv) maxCurv = curv;
  }
  const radius = maxCurv > 1e-4 ? 1 / maxCurv : 1e4;
  const target = Math.max(8, Math.sqrt(1.35 * GRAVITY * radius) * style.aggression);
  const speed = Math.hypot(c.vx, c.vy);
  const over = speed - target;
  // Lift as the rear steps out (like a driver catching a slide).
  const beta = Math.abs(Math.atan2(c.vy, Math.max(1, Math.abs(c.vx))));
  const liftForSlide = Math.max(0, 1 - beta / 0.25);
  input.throttle = over > 0 ? 0 : Math.min(1, 0.35 - over * 0.25) * liftForSlide;
  input.brake = over > 2 ? Math.min(1, over * 0.15) : 0;
  input.handbrake = false;
  input.useItem = false;
}
