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
import {
  RELATCH_ANGLE,
  shouldRelatchCam,
  STICK_RADIUS,
  stickOutput,
} from "../src/lib/kart/joystick";
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

// ── Floating stick: steer, throttle curve, dead zone, clamping ──
{
  const z = stickOutput(0, 0);
  assert(z.steer === 0 && z.throttle === 0 && !z.handbrake && z.target === null, "stick at rest outputs nothing");
  assert(stickOutput(4, 4).steer === 0 && stickOutput(4, 4).throttle === 0, "dead zone ignored");
  assert(stickOutput(0, STICK_RADIUS * 5).throttle <= 1, "offset clamps to the radius");
  // Throttle is the stick DISTANCE, whatever the direction.
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.7071, -0.7071]]) {
    assert(stickOutput(dx * STICK_RADIUS, dy * STICK_RADIUS).throttle > 0.99, `full pull (${dx},${dy}) = full throttle`);
    assert(
      stickOutput(dx * STICK_RADIUS * 0.8, dy * STICK_RADIUS * 0.8).throttle >
        stickOutput(dx * STICK_RADIUS * 0.4, dy * STICK_RADIUS * 0.4).throttle,
      `further pull = more throttle (${dx},${dy})`,
    );
  }
  // Stick angle → world heading through the camera rotation (up = camRot).
  const R = STICK_RADIUS;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  for (const cam of [0, 1.1, -2.3, 3]) {
    assert(angDiff(stickOutput(0, -R, 0, cam).target!, cam) < 1e-9, `up = screen up (cam ${cam})`);
    assert(angDiff(stickOutput(-R, 0, 0, cam).target!, cam + Math.PI / 2) < 1e-9, `left = camera left (cam ${cam})`);
    assert(angDiff(stickOutput(R, 0, 0, cam).target!, cam - Math.PI / 2) < 1e-9, `right = camera right (cam ${cam})`);
    assert(angDiff(stickOutput(0, R, 0, cam).target!, cam + Math.PI) < 1e-9, `down = behind the camera (cam ${cam})`);
  }
  // Steer sign: target to the left steers left (−), to the right steers right (+).
  assert(stickOutput(-R, 0, 0, 0).steer < 0, "target left of heading = steer left");
  assert(stickOutput(R, 0, 0, 0).steer > 0, "target right of heading = steer right");
  assert(Math.abs(stickOutput(0, -R, 0, 0).steer) < 1e-9, "target dead ahead = no steer");
  // Sharp heading change on throttle holds the drift; straight ahead does not.
  assert(!stickOutput(R, 0, 0, 0).handbrake, "stick never holds the handbrake (it pinned the heading)");
  assert(!stickOutput(0, -R, 0, 0).handbrake, "straight ahead does not drift");
  assert(!stickOutput(R * 0.2, 0, 0, 0).handbrake, "sharp turn at tiny throttle does not drift");
}

// ── Screen/camera-space sign: stick left/right must match what the chase cam shows ──
// Production had left/right inverted relative to the phone screen. The heading-up
// camera draws world CCW toward screen-left (`rotate(π/2 − camRot)` after a Y flip
// in renderer.ts), so a screen-left pull must increase heading (CCW) and a
// screen-right pull must decrease it — asserted here in camera space, not only
// as a world-frame target angle.
{
  const R = STICK_RADIUS;
  const DT = 1 / TICK_HZ;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const cam of [0, 0.9, -2.0]) {
    for (const [name, dx, screenSign] of [
      ["left", -R, 1],
      ["right", R, -1],
    ] as const) {
      const c = createCar();
      c.heading = cam; // kart already facing screen-up
      c.vx = 6;
      let steerV = 0;
      for (let i = 0; i < Math.round(0.6 * TICK_HZ); i++) {
        const so = stickOutput(dx, 0, c.heading, cam, undefined, c.r, c.vx, c.vy);
        steerV += Math.max(-4.5 * DT, Math.min(4.5 * DT, so.steer - steerV));
        stepCar(c, { steer: steerV, throttle: so.throttle, brake: 0, handbrake: false, allowReverse: false }, DT);
      }
      // Heading relative to the latched camera: + = toward screen-left.
      const screenYaw = wrap(c.heading - cam);
      assert(
        screenYaw * screenSign > 0.25,
        `screen-${name} stick turns the nose toward screen-${name} in camera space (cam ${cam}: screenYaw ${screenYaw.toFixed(3)})`,
      );
    }
  }
}

// ── Direction-based stick: heading converges to the stick angle, forward only ──
{
  const R = STICK_RADIUS;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const DT = 1 / TICK_HZ;
  /** Closed loop mirroring KartGame: stickOutput → steer ramp → stepCar. */
  const drive = (cam: number, startHeading: number, dx: number, dy: number, secs: number) => {
    const c = createCar();
    c.heading = startHeading;
    c.vx = 8;
    let steerV = 0;
    let minVx = c.vx;
    for (let i = 0; i < secs * TICK_HZ; i++) {
      const so = stickOutput(dx, dy, c.heading, cam, undefined, c.r, c.vx, c.vy);
      steerV += Math.max(-4.5 * DT, Math.min(4.5 * DT, so.steer - steerV));
      stepCar(c, { steer: steerV, throttle: so.throttle, brake: 0, handbrake: so.handbrake, allowReverse: false }, DT);
      minVx = Math.min(minVx, c.vx);
    }
    return { err: angDiff(c.heading, stickOutput(dx, dy, c.heading, cam).target!), minVx };
  };
  // 8 stick directions (screen), unrotated and rotated cameras.
  for (const cam of [0, 0.9, -2.0]) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4; // screen angle, 0 = up, + = left (CCW)
      const dx = -Math.sin(a) * R * 0.8;
      const dy = -Math.cos(a) * R * 0.8;
      // Camera is latched (fixed) for one pull. A 180° pull saturates the
      // steer for longest, so give every direction time to settle.
      const r = drive(cam, cam, dx, dy, 20);
      assert(r.err < 0.3, `heading converges to the stick angle (cam ${cam}, dir ${k * 45}°: err ${r.err.toFixed(3)} rad)`);
      assert(r.minVx >= -1e-3, `stick turns never reverse (cam ${cam}, dir ${k * 45}°: vx ${r.minVx})`);
    }
  }
}

// ── Regression: a held stick with a FOLLOWING camera must not circle ──
// The camera rotates with the kart; the stick maps against the rotation latched
// at thumb-down, so one pull is one fixed world heading.
{
  const R = STICK_RADIUS;
  const DT = 1 / TICK_HZ;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const run = (latch: boolean, dx: number, dy: number) => {
    const c = createCar();
    c.vx = 8;
    let cam = c.heading;
    const latched = cam;
    let steerV = 0;
    const headings: number[] = [];
    for (let i = 0; i < 12 * TICK_HZ; i++) {
      const so = stickOutput(dx, dy, c.heading, latch ? latched : cam, undefined, c.r, c.vx, c.vy);
      steerV += Math.max(-4.5 * DT, Math.min(4.5 * DT, so.steer - steerV));
      stepCar(c, { steer: steerV, throttle: so.throttle, brake: 0, handbrake: so.handbrake, allowReverse: false }, DT);
      // Following camera (same smoothing idea as the renderer).
      cam += Math.atan2(Math.sin(c.heading - cam), Math.cos(c.heading - cam)) * (1 - Math.exp(-DT * 6));
      headings.push(c.heading);
    }
    // Total absolute heading change in the last 3 s ≈ path curvature × distance.
    const tail = headings.slice(-3 * TICK_HZ);
    let turn = 0;
    for (let i = 1; i < tail.length; i++) turn += angDiff(tail[i], tail[i - 1]);
    // Overshoot-plateau guard: error at 4 s and total spin over the whole hold.
    let cum = 0;
    for (let i = 1; i < headings.length; i++) cum += angDiff(headings[i], headings[i - 1]);
    const goal = latched - Math.sign(dx) * (Math.PI / 2);
    const err4 = angDiff(headings[4 * TICK_HZ - 1], goal);
    return { turn, cum, err4, err: angDiff(c.heading, goal) };
  };
  const held = run(true, R * 0.8, 0); // stick right
  assert(held.err4 < 0.3, `held right stick is on target within 4 s (err ${held.err4.toFixed(3)} rad)`);
  assert(held.cum < Math.PI / 2 + Math.PI, `held right stick does not overshoot/spin (total turn ${held.cum.toFixed(2)} rad)`);
  for (const [name, dx] of [["left", -R * 0.8], ["right", R]] as const) {
    const r = run(true, dx, 0);
    assert(r.err4 < 0.3 && r.cum < 1.5 * Math.PI, `${name} hold converges without overshoot (err4 ${r.err4.toFixed(2)}, cum ${r.cum.toFixed(2)})`);
  }
  assert(held.err < 0.3, `held right stick settles on its heading (err ${held.err.toFixed(3)} rad)`);
  assert(held.turn < 0.3, `held right stick stops turning: last 3 s turned ${held.turn.toFixed(3)} rad`);
  const live = run(false, R * 0.8, 0);
  assert(live.turn > held.turn * 3, "live-camera mapping keeps turning (the bug the latch fixes)");
}

// ── Re-latch threshold: thumb wobble keeps the cam; a deliberate re-aim refreshes ──
{
  assert(RELATCH_ANGLE > 0.15, `re-latch threshold raised above thumb-wobble 0.15 (got ${RELATCH_ANGLE})`);
  assert(!shouldRelatchCam(0, 0.2), "0.2 rad thumb wobble must not re-latch the chase cam");
  assert(!shouldRelatchCam(1.0, 1.0 + 0.4), "sub-threshold re-aim keeps the latched cam");
  assert(shouldRelatchCam(0, 0.5), "0.5 rad re-aim re-latches the chase cam");
  assert(shouldRelatchCam(-1, 1), "large wrap-around re-aim re-latches");
}

// ── Full-stick holds FROM REST (the phone gate): settle on target, no circling ──
{
  const R = STICK_RADIUS;
  const DT = 1 / TICK_HZ;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const cases: Array<[string, number, number, number, boolean]> = [
    ["left", -R, 0, Math.PI / 2, false],
    ["right", R, 0, Math.PI / 2, false],
    ["down", 0, R, Math.PI, true], // 180° from rest
    ["up-right", R * Math.SQRT1_2, -R * Math.SQRT1_2, Math.PI / 4, false],
    ["down-right-135", R * Math.SQRT1_2, R * Math.SQRT1_2, (3 * Math.PI) / 4, true],
    ["down-left-135", -R * Math.SQRT1_2, R * Math.SQRT1_2, (3 * Math.PI) / 4, true],
  ];
  for (const [name, dx, dy, turn, fastAim] of cases) {
    const c = createCar();
    c.heading = 0;
    const target = stickOutput(dx, dy, 0, 0).target!;
    let steerV = 0;
    let minVx = 0;
    let cum = 0;
    let late = 0;
    let prev = 0;
    let err15 = Number.POSITIVE_INFINITY;
    let errBelow03At: number | null = null;
    let convergedAt: number | null = null;
    let lateYawAfter = 0;
    const dHist: number[] = [];
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      const so = stickOutput(dx, dy, c.heading, 0, undefined, c.r, c.vx, c.vy);
      const speed = Math.hypot(c.vx, c.vy);
      const rate = so.steer === 0 ? 7 : speed < 12 ? 2.8 + speed * 0.14 : 4.5;
      steerV += Math.max(-rate * DT, Math.min(rate * DT, so.steer - steerV));
      stepCar(c, { steer: steerV, throttle: so.throttle, brake: 0, handbrake: false, allowReverse: false }, DT);
      const d = angDiff(c.heading, prev);
      cum += d;
      if (i >= 6.5 * TICK_HZ) late += d;
      prev = c.heading;
      minVx = Math.min(minVx, c.vx);
      dHist.push(d);
      const err = angDiff(c.heading, target);
      const t = (i + 1) * DT;
      if (Math.abs(t - 1.5) < DT / 2) err15 = err;
      if (errBelow03At === null && err < 0.3) errBelow03At = t;
      if (dHist.length >= TICK_HZ) {
        const yaw = dHist.slice(-TICK_HZ).reduce((a, b) => a + b, 0);
        if (convergedAt === null && err < 0.3 && yaw < 0.2) convergedAt = t;
        if (convergedAt !== null && t > convergedAt && t <= convergedAt + 1) lateYawAfter += d;
      }
    }
    const err = angDiff(c.heading, target);
    assert(err < 0.3, `from-rest full ${name} hold is on target at 8 s (err ${err.toFixed(3)} rad)`);
    assert(late / 1.5 < 0.15, `from-rest full ${name} hold has settled (late rate ${(late / 1.5).toFixed(3)} rad/s)`);
    assert(cum < turn + 0.6, `from-rest full ${name} hold does not circle (total turn ${cum.toFixed(2)} rad)`);
    assert(minVx >= -1e-3, `from-rest full ${name} hold never reverses (vx ${minVx})`);
    if (fastAim) {
      assert(err15 < 0.3, `from-rest ${name} err at 1.5 s < 0.3 (got ${err15.toFixed(3)})`);
      assert(
        errBelow03At !== null && errBelow03At <= 1.5,
        `from-rest ${name} reaches err<0.3 within 1.5 s (got ${errBelow03At})`,
      );
    }
    assert(convergedAt !== null, `from-rest ${name} eventually settles (err+yaw)`);
    assert(
      lateYawAfter < 0.2,
      `from-rest ${name} late yaw after convergence < 0.2 rad/s (got ${lateYawAfter.toFixed(3)})`,
    );
  }
}

// ── Full-stick holds FROM REST through the real stepWorld + track (phone gate pose) ──
// Judged up to the first wall hit or stuck-reset: the heading must have
// converged (err < 0.3 and trailing-1 s yaw rate < 0.2 rad/s) before then,
// and body vx must never go negative on the way.
{
  const R = STICK_RADIUS;
  const DT = 1 / TICK_HZ;
  const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const cases: Array<[string, number, number, boolean]> = [
    ["left", -R, 0, false],
    ["right", R, 0, false],
    ["up-right", R * Math.SQRT1_2, -R * Math.SQRT1_2, false],
    ["down-right-135", R * Math.SQRT1_2, R * Math.SQRT1_2, true],
    ["down-left-135", -R * Math.SQRT1_2, R * Math.SQRT1_2, true],
    ["down-180", 0, R, true],
  ];
  const WIN = TICK_HZ; // trailing 1 s window for the settled-yaw check
  for (const [name, dx, dy, fastAim] of cases) {
    const w = createWorld(THUNDERHILL_LEVEL, 3);
    const camRot = w.car.heading; // camera has caught up with the kart at touch
    const target = stickOutput(dx, dy, w.car.heading, camRot).target!;
    const inp: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, allowReverse: false, useItem: false };
    const dHist: number[] = [];
    let steerV = 0;
    let minVx = 0;
    let prev = w.car.heading;
    let converged = false;
    let err15 = Number.POSITIVE_INFINITY;
    let errBelow03At: number | null = null;
    let stopT = 8;
    let stopWhy = "8 s elapsed";
    const startReset = w.lastResetTick;
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      const c = w.car;
      const so = stickOutput(dx, dy, c.heading, camRot, undefined, c.r, c.vx, c.vy);
      const speed = Math.hypot(c.vx, c.vy);
      const rate = so.steer === 0 ? 7 : speed < 12 ? 2.8 + speed * 0.14 : 4.5;
      steerV += Math.max(-rate * DT, Math.min(rate * DT, so.steer - steerV));
      inp.steer = steerV;
      inp.throttle = so.throttle;
      inp.handbrake = false;
      stepWorld(w, inp);
      if (w.wallHitTick === w.tick || w.lastResetTick !== startReset) {
        stopT = (i + 1) * DT;
        stopWhy = w.wallHitTick === w.tick ? "wall hit" : "stuck reset";
        break;
      }
      dHist.push(angDiff(w.car.heading, prev));
      prev = w.car.heading;
      minVx = Math.min(minVx, w.car.vx);
      const err = angDiff(w.car.heading, target);
      const t = (i + 1) * DT;
      if (Math.abs(t - 1.5) < DT / 2) err15 = err;
      if (errBelow03At === null && err < 0.3) errBelow03At = t;
      if (dHist.length >= WIN) {
        const yaw = dHist.slice(-WIN).reduce((a, b) => a + b, 0) / (WIN * DT);
        if (err < 0.3 && yaw < 0.2) {
          converged = true;
          if (!fastAim) break;
          // Fast aims still run long enough to sample err@1.5s.
          if (t >= 1.5) break;
        }
      }
    }
    assert(minVx >= -1e-3, `stepWorld from-rest ${name} hold never reverses (vx ${minVx})`);
    assert(converged, `stepWorld from-rest ${name} hold converges before the ${stopWhy} at ${stopT.toFixed(2)} s`);
    if (fastAim) {
      assert(err15 < 0.3, `stepWorld from-rest ${name} err at 1.5 s < 0.3 (got ${err15.toFixed(3)})`);
      assert(
        errBelow03At !== null && errBelow03At <= 1.5,
        `stepWorld from-rest ${name} reaches err<0.3 within 1.5 s (got ${errBelow03At})`,
      );
    }
  }
}

// ── Stick through the real sim: pull, brake to a stop, re-pull — never backwards ──
{
  const w = createWorld(THUNDERHILL_LEVEL, 3);
  const R = STICK_RADIUS;
  const inp: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
  const phases: Array<[number, boolean]> = [[2, true], [5, false], [2, true], [4, false]];
  let minVx = 0;
  for (const [secs, pulled] of phases) {
    for (let i = 0; i < secs * TICK_HZ; i++) {
      if (pulled) {
        // Point screen-up (camera follows the heading) at ~60% pull.
        const so = stickOutput(0, -R * 0.6, w.car.heading, w.car.heading);
        inp.steer = so.steer;
        inp.throttle = so.throttle;
        inp.brake = 0;
        inp.handbrake = so.handbrake;
      } else {
        inp.steer = 0;
        inp.throttle = 0;
        inp.brake = 1;
        inp.handbrake = false;
      }
      inp.allowReverse = false;
      stepWorld(w, inp);
      minVx = Math.min(minVx, w.car.vx);
    }
    if (!pulled) assert(Math.abs(w.car.vx) < 0.1, `released stick brakes to a stop (${w.car.vx})`);
    else assert(w.car.vx > 1, `re-pull drives forward again (${w.car.vx})`);
  }
  assert(minVx >= -1e-3, `forward speed never negative through brake + re-pull (${minVx})`);
}

// ── Analog throttle: pull distance scales drive force end to end ──
{
  // Stick output is linear past the dead zone (no on/off collapse).
  const t25 = stickOutput(0, STICK_RADIUS * 0.4).throttle;
  const t50 = stickOutput(0, STICK_RADIUS * 0.5).throttle;
  const t75 = stickOutput(0, STICK_RADIUS * 0.7).throttle;
  assert(t25 > 0 && t25 < t50 && t50 < t75 && t75 < 1, "throttle rises smoothly with pull");
  assert(t50 > 0.35 && t50 < 0.55, `half pull is roughly half throttle (${t50})`);
  assert(Math.abs((t75 - t50) - (t50 - t25) * 2) < 1e-9, "throttle is linear in pull");

  // Net drive force at identical state: a stepCar from 10 m/s, straight.
  const driveForce = (throttle: number): number => {
    const c = createCar();
    c.vx = 10;
    stepCar(c, { steer: 0, throttle, brake: 0, handbrake: false }, 1 / TICK_HZ);
    const drag = 0.42 * 10 * 10 + 140;
    return c.ax * DEFAULT_CAR.massKg + drag;
  };
  const f20 = driveForce(0.2);
  const f40 = driveForce(0.4);
  assert(f20 > 0, "some throttle drives");
  assert(Math.abs(f40 / f20 - 2) < 0.05, `double the throttle gives double the drive force (${f40 / f20})`);
  const fHalf = driveForce(0.5);
  const fFull = driveForce(1);
  assert(fHalf / fFull > 0.4 && fHalf / fFull < 0.6, `half throttle ≈ half drive force (${fHalf / fFull})`);

  // Launch scales with throttle at GO.
  const lw = createWorld(THUNDERHILL_LEVEL, 3);
  const hw = createWorld(THUNDERHILL_LEVEL, 3);
  applyLaunch(lw, 1);
  applyLaunch(hw, 0.5);
  assert(Math.abs(hw.car.vx - lw.car.vx / 2) < 1e-9, "half-throttle launch kicks half as hard");
  assert(hw.miniTicks < lw.miniTicks && hw.miniTicks > 0, "half-throttle launch boosts for less time");
}

// ── No reverse from the stick (Jason: kart drove backwards on release) ──
{
  const TRACK_LEN = createWorld(THUNDERHILL_LEVEL, 3).track.length;
  /** Signed arc-length change, wrap-safe. */
  const dS = (from: number, to: number) => {
    let d = to - from;
    if (d > TRACK_LEN / 2) d -= TRACK_LEN;
    if (d < -TRACK_LEN / 2) d += TRACK_LEN;
    return d;
  };
  // Mirrors KartGame's stick paths: pull = throttle, release = brake, no reverse.
  const pull = (throttle: number): KartInput => ({ steer: 0, throttle, brake: 0, handbrake: false, allowReverse: false, useItem: false });
  const release = (): KartInput => ({ steer: 0, throttle: 0, brake: 1, handbrake: false, allowReverse: false, useItem: false });

  // 1. Pull then release: vx never negative, s never goes back.
  {
    const w = createWorld(THUNDERHILL_LEVEL, 3);
    for (let i = 0; i < 2 * TICK_HZ; i++) stepWorld(w, pull(0.5));
    assert(w.car.vx > 3, `half pull for 2 s drives forward (${w.car.vx})`);
    let prevS = w.hit.s;
    let backed = 0;
    for (let i = 0; i < 6 * TICK_HZ; i++) {
      stepWorld(w, release());
      assert(w.car.vx >= -1e-3, `released stick never reverses (vx ${w.car.vx}, tick ${i})`);
      backed = Math.max(backed, -dS(prevS, w.hit.s) > 0 ? -dS(prevS, w.hit.s) : 0);
      prevS = w.hit.s;
    }
    assert(Math.abs(w.car.vx) < 0.05, `released stick brakes to a stop (${w.car.vx})`);
    assert(backed <= 0.5, `released stick never rolls back (${backed} m)`);
  }

  // 2. Thumb pattern: pulls with releases in between. Deterministic PRNG.
  {
    const w = createWorld(THUNDERHILL_LEVEL, 3);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    let net = 0;
    let prevS = w.hit.s;
    for (let n = 0; n < 20; n++) {
      const pullTicks = Math.round((0.3 + 0.5 * rnd()) * TICK_HZ);
      const relTicks = Math.round((0.3 + 0.5 * rnd()) * TICK_HZ);
      const th = 0.2 + 0.8 * rnd();
      for (let i = 0; i < pullTicks + relTicks; i++) {
        stepWorld(w, i < pullTicks ? pull(th) : release());
        assert(w.car.vx >= -1e-3, `thumb pattern never reverses (vx ${w.car.vx})`);
        net += dS(prevS, w.hit.s);
        prevS = w.hit.s;
      }
    }
    assert(net > 0, `thumb pattern makes net forward progress (${net})`);
  }

  // 3. From rest, any throttle moves the kart forward, monotonically.
  for (const th of [0.05, 0.2, 0.5, 1]) {
    const w = createWorld(THUNDERHILL_LEVEL, 3);
    let prev = w.car.vx;
    for (let i = 0; i < TICK_HZ; i++) {
      stepWorld(w, pull(th));
      assert(w.car.vx >= prev - 1e-6, `vx rises monotonically from rest (throttle ${th})`);
      prev = w.car.vx;
    }
    assert(w.car.vx > 0, `throttle ${th} from rest gives vx > 0 (${w.car.vx})`);
  }

  // 4. The explicit brake (keyboard / Realistic) can still reverse.
  {
    const w = createWorld(THUNDERHILL_LEVEL, 3);
    const back: KartInput = { steer: 0, throttle: 0, brake: 1, handbrake: false, useItem: false };
    for (let i = 0; i < 3 * TICK_HZ; i++) stepWorld(w, back);
    assert(w.car.vx < -0.5, `explicit brake still reverses (${w.car.vx})`);
  }
}

// ── Altitude: real USGS relief, and gravity along the slope ──
{
  const t = createWorld(THUNDERHILL_LEVEL, 1).track;
  const top = Math.max(...t.pz);
  assert(top > 10 && top < 30, `track climbs a real hill (${top.toFixed(1)} m)`);
  let up = 0;
  let down = 0;
  for (let k = 0; k < t.count; k += 1) {
    if (t.grade[k] > t.grade[up]) up = k;
    if (t.grade[k] < t.grade[down]) down = k;
  }
  assert(t.grade[up] > 0.04 && t.grade[down] < -0.04, "has real climbs and descents");
  function coastAt(k: number) {
    const w = createWorld(THUNDERHILL_LEVEL, 1);
    w.car.x = t.px[k];
    w.car.y = t.py[k];
    w.car.heading = Math.atan2(t.ty[k], t.tx[k]);
    w.car.vx = 15;
    w.hit.index = k;
    const coast: KartInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, useItem: false };
    for (let i = 0; i < TICK_HZ * 0.8; i += 1) stepWorld(w, coast);
    return Math.hypot(w.car.vx, w.car.vy);
  }
  const uphill = coastAt(up);
  const downhill = coastAt(down);
  assert(downhill > uphill + 0.5, `gravity: coasting downhill keeps more speed than uphill (${downhill.toFixed(2)} vs ${uphill.toFixed(2)} m/s)`);
}

console.log(JSON.stringify({
  ok: true,
  lap1Ms: lap1,
  lap2Ms: ticksToMs(world.lapTicks[1]),
  trackM: Math.round(world.track.length),
  drift: { calm: +calm.toFixed(3), power: +power.toFixed(3), handbrake: +hand.toFixed(3) },
  score: world.score,
}));
