/**
 * Apex Kart (#48) sim contracts: tire model limits, load transfer, gates in
 * order, grass slowdown, items, drift scoring and determinism — driven by a
 * simple pure-pursuit bot on the Thunderhill level.
 */
import { computeLoads, createCar, DEFAULT_CAR, GRAVITY, stepCar } from "../src/lib/kart/car";
import { THUNDERHILL_LEVEL } from "../src/lib/kart/levels/thunderhill";
import {
  createWorld,
  hashWorld,
  ITEM_NONE,
  ITEM_OIL,
  ITEM_TURBO,
  SURFACE_GRASS,
  stepWorld,
  ticksToMs,
  TICK_HZ,
  type KartInput,
  type KartWorld,
} from "../src/lib/kart/sim";
import { DEFAULT_TIRE, lateralForce, magicFormula, peakForce } from "../src/lib/kart/tire";
import { botInput, DEFAULT_BOT } from "../src/lib/kart/bot";
import { projectOnTrack } from "../src/lib/kart/track";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// ── Tire: friction ellipse caps combined force ──
for (const alpha of [0.02, 0.08, 0.15, 0.4, 1.2]) {
  for (const fxFrac of [0, 0.3, 0.7, 0.95, 1]) {
    const fz = 2600;
    const fmax = peakForce(fz, DEFAULT_TIRE);
    const fx = fxFrac * fmax;
    const fy = lateralForce(alpha, fz, fx, DEFAULT_TIRE);
    const usage = Math.hypot(fx / fmax, fy / fmax);
    assert(usage <= 1 + 1e-9, `friction ellipse respected (alpha ${alpha}, fx ${fxFrac}: ${usage})`);
  }
}
assert(Math.abs(magicFormula(0, 9.5, 1.65, 0.6)) < 1e-12, "no force at zero slip");
assert(lateralForce(0.1, 2600, 0, DEFAULT_TIRE) < 0, "force opposes slip");
// Load sensitivity: double the load gives less than double the grip.
assert(peakForce(5200, DEFAULT_TIRE) < 2 * peakForce(2600, DEFAULT_TIRE), "mu drops with load");

// ── Load transfer sums to total weight ──
const car = createCar();
for (const [ax, ay] of [[0, 0], [6, 0], [-9, 0], [0, 8], [3, -7], [-12, 11]]) {
  car.ax = ax;
  car.ay = ay;
  computeLoads(car);
  const sum = car.fz[0] + car.fz[1] + car.fz[2] + car.fz[3];
  assert(Math.abs(sum - DEFAULT_CAR.massKg * GRAVITY) < 1e-6, `loads sum to m·g (ax ${ax}, ay ${ay}: ${sum})`);
  for (const f of car.fz) assert(f >= 0, "no negative wheel load");
}
car.ax = 6; car.ay = 0; computeLoads(car);
assert(car.fz[2] + car.fz[3] > car.fz[0] + car.fz[1], "accelerating loads the rear");
car.ax = 0; car.ay = 8; computeLoads(car);
assert(car.fz[1] + car.fz[3] > car.fz[0] + car.fz[2], "turning left loads the right side");

// ── Power oversteer: full throttle in a turn spins the rear, gentle doesn't ──
function rearSlipAfter(throttle: number, handbrake = false) {
  const c = createCar();
  c.vx = 18;
  for (let i = 0; i < TICK_HZ * 1.2; i += 1) {
    stepCar(c, { steer: -0.6, throttle, brake: 0, handbrake }, 1 / TICK_HZ);
  }
  return Math.abs(Math.atan2(c.vy, Math.abs(c.vx)));
}
const calm = rearSlipAfter(0.15);
const power = rearSlipAfter(1);
const hand = rearSlipAfter(0.4, true);
assert(power > calm, `throttle breaks the rear loose (calm ${calm.toFixed(3)}, power ${power.toFixed(3)})`);
assert(hand > calm, `handbrake kicks the rear out (${hand.toFixed(3)})`);

// ── Bot driver (shared headless bot) ──
function bot(world: KartWorld, input: KartInput, opts: { offset?: number } = {}) {
  botInput(world, input, { ...DEFAULT_BOT, aggression: 0.8, offset: opts.offset ?? 0 });
}

const input: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
const world = createWorld(THUNDERHILL_LEVEL, 42);
const gatesSeen: number[] = [];
let lastGate = world.nextGate;
const maxTicks = TICK_HZ * 240;
while (world.lapsDone < 2 && world.tick < maxTicks) {
  bot(world, input);
  stepWorld(world, input);
  if (world.nextGate !== lastGate) {
    gatesSeen.push(lastGate);
    lastGate = world.nextGate;
  }
}
assert(world.lapsDone >= 2, `bot completes 2 laps (done ${world.lapsDone} in ${(world.tick / TICK_HZ).toFixed(0)} s, gate ${world.nextGate})`);
const lap1 = ticksToMs(world.lapTicks[0]);
assert(lap1 > 25_000 && lap1 < 95_000, `lap time is kart-sized (${lap1} ms)`);
assert(gatesSeen.slice(0, 8).join(",") === "1,2,3,4,5,6,7,0", `gates in order (${gatesSeen.slice(0, 9)})`);

// ── Skipping a gate doesn't count the lap ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 1);
  // Teleport near gate 3 without passing 1 and 2, then drive through gate 0 area.
  const track = w.track;
  const k = Math.floor(track.count * 0.9);
  w.car.x = track.px[k];
  w.car.y = track.py[k];
  w.car.heading = Math.atan2(track.ty[k], track.tx[k]);
  w.hit.index = k;
  w.prevS = track.s[k];
  for (let i = 0; i < TICK_HZ * 12; i += 1) {
    bot(w, input);
    stepWorld(w, input);
  }
  assert(w.lapsDone === 0, "crossing the line without the gates does not count a lap");
}

// ── Grass slows the car ──
{
  function coastFrom(offset: number) {
    const w = createWorld(THUNDERHILL_LEVEL, 1);
    const t = w.track;
    const k = 40;
    w.car.x = t.px[k] - t.ty[k] * offset;
    w.car.y = t.py[k] + t.tx[k] * offset;
    w.car.heading = Math.atan2(t.ty[k], t.tx[k]);
    w.car.vx = 20;
    w.hit.index = k;
    const coast: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
    let sawGrass = false;
    for (let i = 0; i < TICK_HZ; i += 1) {
      stepWorld(w, coast);
      if (w.surface === SURFACE_GRASS) sawGrass = true;
    }
    return { speed: Math.hypot(w.car.vx, w.car.vy), sawGrass };
  }
  const asphalt = coastFrom(0);
  const grass = coastFrom(THUNDERHILL_LEVEL.halfWidth + 5);
  assert(grass.sawGrass && !asphalt.sawGrass, "offset car is on the grass, centre car is not");
  assert(grass.speed < asphalt.speed * 0.7, `grass slows the car (asphalt ${asphalt.speed.toFixed(1)} vs grass ${grass.speed.toFixed(1)} m/s)`);
}

// ── Items: pick up, Turbo boosts, Oil spins ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 7);
  let picked = 0;
  for (let i = 0; i < TICK_HZ * 60 && picked === 0; i += 1) {
    bot(w, input);
    stepWorld(w, input);
    picked = w.item;
  }
  assert(picked === ITEM_TURBO, "the first item box always gives a Turbo");
  w.item = ITEM_TURBO;
  input.useItem = true;
  stepWorld(w, input);
  input.useItem = false;
  assert(w.item === ITEM_NONE && w.turboTicks > 0, "Turbo fires");
  assert(w.car.boostForce === 0 || w.turboTicks > 0, "boost active");
  stepWorld(w, input); // release the button (item use is edge-triggered)
  w.item = ITEM_OIL;
  input.useItem = true;
  stepWorld(w, input);
  input.useItem = false;
  assert(w.slickActive.some((v) => v === 1), "Oil slick dropped");
}

// ── First item row sits before gate 1, so new players find a box early ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 3);
  const t = w.track;
  const hitTmp = { index: 0, s: 0, d: 0 };
  let minS = Infinity;
  for (let b = 0; b < t.boxX.length; b += 1) {
    hitTmp.index = 0;
    projectOnTrack(t, t.boxX[b], t.boxY[b], hitTmp, true);
    minS = Math.min(minS, hitTmp.s);
  }
  assert(minS > w.hit.s && minS < t.gates[1], `a box lies between the start and gate 1 (s ${minS.toFixed(0)}, gate1 ${t.gates[1].toFixed(0)})`);
}

// ── Launch: full throttle reaches cruise speed fast ──
const CRUISE_MS = 14; // ≈ 50 km/h
function launch(skipStartBoost: boolean) {
  const w = createWorld(THUNDERHILL_LEVEL, 5);
  if (skipStartBoost) w.launchChecked = true;
  const gas: KartInput = { steer: 0, throttle: 1, brake: 0, handbrake: false, useItem: false };
  let cruiseTicks = -1;
  let speedAt3s = 0;
  for (let i = 1; i <= TICK_HZ * 3; i += 1) {
    stepWorld(w, gas);
    const v = Math.hypot(w.car.vx, w.car.vy);
    if (cruiseTicks < 0 && v >= CRUISE_MS) cruiseTicks = i;
    if (i === TICK_HZ * 3) speedAt3s = v;
  }
  return { cruiseS: cruiseTicks < 0 ? Infinity : cruiseTicks / TICK_HZ, speedAt3s, boosted: w.startBoosted };
}
const launchBoosted = launch(false);
const launchPlain = launch(true);
assert(launchBoosted.boosted && !launchPlain.boosted, "gas on GO gives the start boost; skipping the window does not");
assert(launchPlain.cruiseS <= 1.6, `0→${CRUISE_MS} m/s within 1.6 s without the start boost (${launchPlain.cruiseS.toFixed(2)} s)`);
assert(launchBoosted.cruiseS <= 1.3, `0→${CRUISE_MS} m/s within 1.3 s with the start boost (${launchBoosted.cruiseS.toFixed(2)} s)`);
assert(launchBoosted.cruiseS < launchPlain.cruiseS, "start boost is faster than a plain launch");
assert(launchPlain.speedAt3s * 3.6 > 70, `gas alone passes 70 km/h in 3 s (${(launchPlain.speedAt3s * 3.6).toFixed(0)} km/h)`);

// Late gas (after the GO window) gets no start boost.
{
  const w = createWorld(THUNDERHILL_LEVEL, 5);
  const idle: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
  for (let i = 0; i < TICK_HZ * 2; i += 1) stepWorld(w, idle);
  stepWorld(w, { ...idle, throttle: 1 });
  assert(!w.startBoosted, "gas after the GO window gives no start boost");
}

// ── Drift: a sustained drift ends in a mini-turbo, not a wipe-out ──
/** Put the car on the centerline at track point 40 (a straight), heading along it. */
function placeOnStraight(w: KartWorld, vx: number) {
  const k = 40;
  w.car.x = w.track.px[k];
  w.car.y = w.track.py[k];
  w.car.heading = Math.atan2(w.track.ty[k], w.track.tx[k]);
  w.car.vx = vx;
  w.hit.index = k;
  w.prevS = w.track.s[k];
}
function straightenAfterDrift(driftSeconds: number, boostControl = false) {
  const w = createWorld(THUNDERHILL_LEVEL, 11);
  placeOnStraight(w, 20);
  w.score = 10;
  if (!boostControl) {
    w.drifting = true;
    w.driftTicks = Math.round(driftSeconds * TICK_HZ);
    w.driftPending = 400;
  }
  const coast: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
  for (let i = 0; i < TICK_HZ; i += 1) stepWorld(w, coast);
  return w;
}
{
  const long = straightenAfterDrift(1.5);
  const control = straightenAfterDrift(0, true);
  assert(long.lastWipeTick < 0, "a long drift is not a wipe-out");
  assert(long.score >= 410, `drift points are banked on release (score ${long.score})`);
  assert(long.boostLevel === 2 && long.lastBoostTick > 0, `1.5 s drift fires a level-2 mini-turbo (level ${long.boostLevel})`);
  assert(long.car.vx > control.car.vx + 1, `mini-turbo makes you faster (${long.car.vx.toFixed(1)} vs ${control.car.vx.toFixed(1)} m/s)`);
  const short = straightenAfterDrift(0.3);
  assert(short.boostLevel === 0 && short.score >= 410, "a short drift banks points but gives no turbo");
  const longer = straightenAfterDrift(2.2);
  assert(longer.boostLevel === 3, "a 2+ s drift charges the top mini-turbo");

  // Only a real spin loses the pending drift — and never the banked score.
  const w = createWorld(THUNDERHILL_LEVEL, 11);
  placeOnStraight(w, 5);
  w.car.vy = 15; // slip angle ≈ 1.25 rad
  w.score = 50;
  w.drifting = true;
  w.driftTicks = 100;
  w.driftPending = 120;
  stepWorld(w, { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false });
  assert(w.lastWipeTick === w.tick && w.driftPending === 0, "a real spin drops the pending drift");
  assert(w.score === 50, "a spin never zeroes the banked score");

  // Running onto the grass keeps half the pending drift.
  const g = createWorld(THUNDERHILL_LEVEL, 11);
  const k = 40;
  g.car.x = g.track.px[k] - g.track.ty[k] * (THUNDERHILL_LEVEL.halfWidth + 5);
  g.car.y = g.track.py[k] + g.track.tx[k] * (THUNDERHILL_LEVEL.halfWidth + 5);
  g.car.heading = Math.atan2(g.track.ty[k], g.track.tx[k]);
  g.car.vx = 20;
  g.hit.index = k;
  g.drifting = true;
  g.driftTicks = 100;
  g.driftPending = 200;
  g.score = 30;
  // A few ticks: the first one only refreshes the track projection.
  for (let i = 0; i < 4; i += 1) {
    stepWorld(g, { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false });
  }
  assert(g.score === 130 && g.lastWipeTick < 0, `grass banks half the drift (score ${g.score})`);
}

// ── Off-track recovery: grass slows you, but flat-out you keep a healthy pace ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 2);
  const t = w.track;
  const k = 40;
  w.car.x = t.px[k] - t.ty[k] * (THUNDERHILL_LEVEL.halfWidth + 5);
  w.car.y = t.py[k] + t.tx[k] * (THUNDERHILL_LEVEL.halfWidth + 5);
  w.car.heading = Math.atan2(t.ty[k], t.tx[k]);
  w.car.vx = 25;
  w.hit.index = k;
  w.launchChecked = true;
  const gas: KartInput = { steer: 0, throttle: 1, brake: 0, handbrake: false, useItem: false };
  let minSpeed = Infinity;
  for (let i = 0; i < TICK_HZ * 3; i += 1) {
    stepWorld(w, gas);
    minSpeed = Math.min(minSpeed, Math.hypot(w.car.vx, w.car.vy));
  }
  assert(minSpeed * 3.6 > 30, `grass keeps a higher floor speed (${(minSpeed * 3.6).toFixed(0)} km/h min)`);
}

// ── Determinism: same seed + inputs ⇒ same hash ──
function run(seed: number) {
  const w = createWorld(THUNDERHILL_LEVEL, seed);
  const inp: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
  for (let i = 0; i < TICK_HZ * 30; i += 1) {
    bot(w, inp);
    inp.handbrake = i % 300 > 280;
    inp.useItem = i % 500 === 0;
    stepWorld(w, inp);
  }
  return hashWorld(w);
}
assert(run(9) === run(9), "same seed and inputs replay identically");

console.log(JSON.stringify({
  ok: true,
  lap1Ms: lap1,
  lap2Ms: ticksToMs(world.lapTicks[1]),
  trackM: Math.round(world.track.length),
  drift: { calm: +calm.toFixed(3), power: +power.toFixed(3), handbrake: +hand.toFixed(3) },
  score: world.score,
}));
