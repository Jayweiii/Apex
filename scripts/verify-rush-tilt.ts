/**
 * Apex Rush tilt steering: the phone's orientation maps to steering the same
 * way in portrait and both landscapes, held flat or upright like a wheel.
 * Run with `npm test -- rush-tilt`.
 */
import { TILT_DEAD_DEG, TILT_FULL_DEG, tiltSteer } from "../src/lib/rush/tilt";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// Level: straight, whichever way the phone faces you.
for (const beta of [0, 30, 60, 90]) assert(tiltSteer(beta, 0, 0) === 0, `portrait, beta ${beta}: straight`);
for (const gamma of [0, 30, 60]) assert(tiltSteer(0, gamma, 90) === 0, `landscape, tipped towards you ${gamma}°: straight`);
assert(tiltSteer(0, 0, 90) === 0 && tiltSteer(0, 0, -90) === 0, "flat landscape: straight");

// Portrait, held flat-ish: tip the right edge down (gamma > 0) to steer right.
assert(tiltSteer(30, 10, 0) > 0, "portrait: right edge down steers right");
assert(tiltSteer(30, -10, 0) < 0, "portrait: left edge down steers left");
assert(near(tiltSteer(30, 10, 0), -tiltSteer(30, -10, 0)), "portrait: symmetric");

// Dead zone and full lock.
assert(tiltSteer(0, TILT_DEAD_DEG * 0.8, 0) === 0, "inside the dead zone: straight");
assert(tiltSteer(0, TILT_FULL_DEG + 5, 0) === 1, "past full tilt: full right");
assert(tiltSteer(0, -(TILT_FULL_DEG + 5), 0) === -1, "past full tilt: full left");
const half = tiltSteer(0, (TILT_DEAD_DEG + TILT_FULL_DEG) / 2, 0);
assert(half > 0.4 && half < 0.6, `half tilt gives about half lock (${half})`);

// Landscape, screen turned 90° (phone rotated counter-clockwise, top to the
// left): the screen's right is the device's bottom. Raising the top (beta > 0)
// drops the screen's right side: steer right.
assert(tiltSteer(10, 0, 90) > 0, "landscape 90: screen-right down steers right");
assert(tiltSteer(-10, 0, 90) < 0, "landscape 90: screen-left down steers left");
// The other landscape mirrors it.
assert(tiltSteer(10, 0, -90) < 0 && tiltSteer(10, 0, 270) < 0, "landscape 270: mirrored");
assert(near(tiltSteer(10, 0, 270), tiltSteer(10, 0, -90)), "270 and -90 are the same screen");

// Upright like a wheel (beta 90 in portrait) turned clockwise: the device's
// right edge drops. Expressed as Euler angles that is beta 90 with gamma > 0
// mixing in; check the steering grows smoothly with the turn and keeps its sign.
let last = 0;
for (const g of [15, 30, 45, 60]) {
  const s = tiltSteer(75, g, 0);
  assert(s > last, `upright, turning right ${g}°: steers further right`);
  last = s;
}
// Tilting the phone towards or away from you (beta only) never steers.
for (const beta of [-20, 10, 45, 80, 120]) assert(tiltSteer(beta, 0, 0) === 0, `pitch ${beta}° alone: straight`);

console.log("verify-rush-tilt: ok");
