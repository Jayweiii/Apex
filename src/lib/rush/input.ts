/**
 * Apex Rush touch stick. One thumb does everything:
 *   - drag left / right  → steer
 *   - push to the edge   → drift that way (hold to charge the mini-turbo)
 *   - ease back / let go → the drift ends and the boost fires
 *   - pull down          → brake
 * The kart accelerates by itself.
 */
export const STICK_RADIUS = 58;
/** Sideways fraction of the radius that starts a drift. */
export const DRIFT_EDGE = 0.8;
/** Sideways fraction below which a running drift is let go. */
export const DRIFT_HOLD = 0.3;
export const BRAKE_PULL = 0.62;
const DEAD = 0.07;

export type StickInput = { steer: number; brake: number; drift: boolean };

/**
 * @param dx,dy   thumb offset from where it landed (px, +x right, +y down)
 * @param drifting the kart's current drift direction (−1 left, +1 right, 0 none)
 */
export function stickInput(dx: number, dy: number, drifting: number, out: StickInput, radius = STICK_RADIUS): StickInput {
  const nx = Math.max(-1, Math.min(1, dx / radius));
  const ny = dy / radius;
  const ax = Math.abs(nx);
  const side = nx > 0 ? 1 : -1;
  out.brake = ny > BRAKE_PULL && ax < 0.6 ? 1 : 0;
  if (drifting !== 0 && side === drifting && ax > DRIFT_HOLD && out.brake === 0) {
    // Holding the drift: the stick's sideways travel sets how tight it is.
    const inward = (ax - (DRIFT_HOLD + 1) / 2) / ((1 - DRIFT_HOLD) / 2);
    out.steer = drifting * Math.max(-1, Math.min(1, inward));
    out.drift = true;
    return out;
  }
  out.steer = ax < DEAD ? 0 : side * ((ax - DEAD) / (1 - DEAD));
  out.drift = drifting === 0 && ax >= DRIFT_EDGE && out.brake === 0;
  return out;
}
