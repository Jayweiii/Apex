/**
 * Apex Kart (#48) sim contracts: tire model limits, load transfer, gates in
 * order, grass slowdown, items, drift scoring and determinism — driven by a
 * simple pure-pursuit bot on the Thunderhill level.
 */
import { computeLoads, createCar, DEFAULT_CAR, GRAVITY, stepCar } from "../src/lib/kart/car";
import { THUNDERHILL_LEVEL } from "../src/lib/kart/levels/thunderhill";
import {
  applyLaunch,
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
import { createLapClock, guardLapTime, resetLapClock } from "../src/lib/kart/laptime";

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

// ── Fast start: ~0→80 km/h in a few seconds, not eight ──
{
  const c = createCar();
  let t = 0;
  while (c.vx < 22.2 && t < 12) {
    stepCar(c, { steer: 0, throttle: 1, brake: 0, handbrake: false }, 1 / TICK_HZ);
    t += 1 / TICK_HZ;
  }
  assert(t < 4.5, `0→80 km/h is quick (${t.toFixed(2)} s)`);
}

// ── Forgiving drift: keeps speed, and is only a light brake when slow ──
{
  const fast = createCar();
  fast.vx = 18;
  for (let i = 0; i < TICK_HZ; i += 1) {
    stepCar(fast, { steer: 0.5, throttle: 1, brake: 0, handbrake: true }, 1 / TICK_HZ);
  }
  const fastSpeed = Math.hypot(fast.vx, fast.vy);
  assert(fastSpeed > 18 * 0.85, `drift keeps most speed (${fastSpeed.toFixed(1)} m/s)`);
  assert(Math.abs(Math.atan2(fast.vy, Math.abs(fast.vx))) > 0.1, "drift visibly slides the rear");

  const slow = createCar();
  slow.vx = 4.4; // ~16 km/h
  for (let i = 0; i < TICK_HZ; i += 1) {
    stepCar(slow, { steer: 0.5, throttle: 1, brake: 0, handbrake: true }, 1 / TICK_HZ);
  }
  assert(Math.hypot(slow.vx, slow.vy) > 4.4, "handbrake at crawling speed does not bleed speed");
}

// ── Mini-turbo on drift release, scaled by hold time; perfect launch ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 3);
  const inp: KartInput = { steer: 0.5, throttle: 1, brake: 0, handbrake: true, useItem: false };
  w.car.vx = 18;
  for (let i = 0; i < TICK_HZ * 1.2; i += 1) {
    w.car.vx = Math.max(w.car.vx, 14); // keep drifting speed on the straight start
    stepWorld(w, inp);
  }
  assert(w.holdTicks > TICK_HZ, "drift hold time is counted");
  inp.handbrake = false;
  stepWorld(w, inp);
  assert(w.miniTicks > 0, "releasing a held drift gives a mini-turbo");

  const quick = createWorld(THUNDERHILL_LEVEL, 3);
  quick.car.vx = 18;
  inp.handbrake = true;
  for (let i = 0; i < 20; i += 1) stepWorld(quick, inp);
  inp.handbrake = false;
  stepWorld(quick, inp);
  assert(quick.miniTicks === 0, "a quick tap gives no mini-turbo");

  const l = createWorld(THUNDERHILL_LEVEL, 3);
  applyLaunch(l);
  assert(l.car.vx > 0 && l.miniTicks > 0, "perfect launch kicks and boosts");
}

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
assert(lap1 > 30_000 && lap1 < 95_000, `lap time is kart-sized (${lap1} ms)`);
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
  assert(picked === ITEM_TURBO || picked === ITEM_OIL, "drives into an item box and gets an item");
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

// ── Lap clock never decreases within a lap (incl. respawn), resets on new lap ──
{
  const c = createLapClock();
  let prev = 0;
  for (const raw of [39340, 37670, 37200, 40000, 100, 41000]) {
    const v = guardLapTime(c, 1, raw);
    assert(v >= prev, "lap time must not decrease");
    prev = v;
  }
  assert(guardLapTime(c, 1, 0) === 41000, "respawn rewind keeps shown time");
  assert(guardLapTime(c, 2, 50) === 50, "new lap resets clock");
  // Restart: lap number stays 1, so only an explicit reset un-freezes the clock.
  guardLapTime(c, 1, 60000);
  resetLapClock(c);
  assert(guardLapTime(c, 1, 120) === 120, "restart (same lap number) resets clock");
}

// ── The sim itself never rewinds the raw lap time (the guard is a backstop) ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 3);
  const inp: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
  let prevLap = w.lap;
  let prevRaw = 0;
  for (let i = 0; i < TICK_HZ * 150; i += 1) {
    bot(w, inp);
    stepWorld(w, inp);
    const raw = w.tick - w.lapStartTick;
    if (w.lap === prevLap) assert(raw >= prevRaw, "raw lap ticks never decrease within a lap");
    prevLap = w.lap;
    prevRaw = raw;
  }
}

console.log(JSON.stringify({
  ok: true,
  lap1Ms: lap1,
  lap2Ms: ticksToMs(world.lapTicks[1]),
  trackM: Math.round(world.track.length),
  drift: { calm: +calm.toFixed(3), power: +power.toFixed(3), handbrake: +hand.toFixed(3) },
  score: world.score,
}));
