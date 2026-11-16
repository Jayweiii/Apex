/**
 * Apex Sim contracts: the ND Miata model against published figures, the
 * full-scale track, lap timing and ghosts. Pure sim, no DOM.
 * Run with `npm test -- sim`.
 */
import westData from "../src/lib/rush/data/thunderhill-west.json";
import { carSpeed, createCar, engineTorque, ND_MIATA, placeCar, rpmInGear, stepCar, type Car, type CarInput } from "../src/lib/sim/car";
import { createControlState, DEFAULT_ASSISTS, shapeControls, usefulLock, type RawControls } from "../src/lib/sim/controls";
import { bundledRealLap, ghostDelta, ghostFromRealLap, ghostFromRecording, ghostPose, type GhostPose } from "../src/lib/sim/ghost";
import { blankInput, createPilot, createSession, DT, pilotInput, resetToTrack, stepSession } from "../src/lib/sim/session";
import { buildSimTrack, groundHeight, projectOnTrack, type SimTrackData } from "../src/lib/sim/track";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const mph = (v: number) => v * 2.23694;

// ── Track: full scale, real hills, no exaggeration ──
const track = buildSimTrack(westData as SimTrackData);
assert(Math.abs(track.length - westData.lengthM) < 25, `track is 1:1 with the survey (${track.length.toFixed(0)} m vs ${westData.lengthM} m)`);
assert(Math.abs(track.spacing - 1) < 0.01, "samples are one metre apart");
let rawMin = Infinity;
let rawMax = -Infinity;
for (const p of westData.pts) {
  rawMin = Math.min(rawMin, p[2]!);
  rawMax = Math.max(rawMax, p[2]!);
}
assert(track.relief <= rawMax - rawMin + 0.01 && track.relief > (rawMax - rawMin) * 0.85, `relief matches the survey (${track.relief.toFixed(1)} m of ${(rawMax - rawMin).toFixed(1)} m)`);
let maxGrade = 0;
let minRadius = Infinity;
for (let i = 0; i < track.n; i += 1) {
  maxGrade = Math.max(maxGrade, Math.abs(track.grade[i]!));
  minRadius = Math.min(minRadius, 1 / Math.max(1e-6, Math.abs(track.curv[i]!)));
}
assert(maxGrade < 0.12, `grades are believable (${(maxGrade * 100).toFixed(1)}%)`);
assert(minRadius > 10 && minRadius < 30, `tightest corner radius is real-sized (${minRadius.toFixed(1)} m)`);
{
  const hit = { i: 0, s: 0, d: 0 };
  projectOnTrack(track, track.px[500]!, track.py[500]!, hit, true);
  assert(Math.abs(groundHeight(track, track.px[500]!, track.py[500]!, hit) - track.pz[500]!) < 0.05, "ground height on the road is the road");
}

// ── A flat proving ground for straight-line and skid-pad tests ──
const ring: number[][] = [];
for (let i = 0; i < 400; i += 1) {
  const a = (i / 400) * Math.PI * 2;
  ring.push([3000 * Math.sin(a), 3000 * (1 - Math.cos(a)), 0]);
}
const flat = buildSimTrack({ id: "flat", name: "", location: "", origin: { lat: 0, lon: 0 }, lengthM: 0, pts: ring, grid: null });
flat.halfWidth = 1e7;

function fresh(speed = 0): { car: Car; inp: CarInput } {
  const car = createCar(ND_MIATA);
  placeCar(car, flat, 10, 0, speed);
  return { car, inp: blankInput() };
}

// Engine: peak torque and power match the 2.0 Skyactiv.
{
  let peakT = 0;
  let peakKw = 0;
  for (let rpm = 1000; rpm <= 7500; rpm += 50) {
    const t = engineTorque(ND_MIATA, rpm);
    peakT = Math.max(peakT, t);
    peakKw = Math.max(peakKw, (t * rpm * Math.PI) / 30 / 1000);
  }
  assert(Math.abs(peakT - 205) < 3, `peak torque ${peakT.toFixed(0)} Nm (published 205)`);
  assert(peakKw > 130 && peakKw < 140, `peak power ${peakKw.toFixed(0)} kW (published 135)`);
  assert(mph(7500 / (rpmInGear(ND_MIATA, 2, 1))) > 60 && mph(7500 / rpmInGear(ND_MIATA, 2, 1)) < 66, "second gear tops out just over 60 mph");
}

// 0–60 mph, quarter mile and top speed.
{
  const { car, inp } = fresh();
  inp.throttle = 1;
  let t = 0;
  let t60 = 0;
  let quarter = 0;
  let trap = 0;
  const x0 = car.x;
  const y0 = car.y;
  while (t < 70) {
    stepCar(car, inp, flat, DT);
    t += DT;
    if (!t60 && carSpeed(car) >= 26.82) t60 = t;
    if (!quarter && Math.hypot(car.x - x0, car.y - y0) >= 402.3) {
      quarter = t;
      trap = mph(carSpeed(car));
    }
  }
  assert(t60 > 5.5 && t60 < 6.8, `0–60 mph in ${t60.toFixed(2)} s (road tests: about 5.7–6.5)`);
  assert(quarter > 14.2 && quarter < 15.3 && trap > 91 && trap < 100, `quarter mile ${quarter.toFixed(2)} s at ${trap.toFixed(0)} mph (road tests: about 14.5 at 95)`);
  const top = mph(carSpeed(car));
  assert(top > 128 && top < 146, `top speed ${top.toFixed(0)} mph (published about 135–140)`);
}

// Braking from 60 mph, with and without anti-lock.
function stopFrom60(abs: boolean): number {
  const { car, inp } = fresh(26.82);
  inp.brake = 1;
  inp.abs = abs;
  const x0 = car.x;
  const y0 = car.y;
  let t = 0;
  while (carSpeed(car) > 0.3 && t < 10) {
    stepCar(car, inp, flat, DT);
    t += DT;
  }
  return Math.hypot(car.x - x0, car.y - y0);
}
{
  const withAbs = stopFrom60(true);
  const locked = stopFrom60(false);
  assert(withAbs > 30 && withAbs < 38, `60–0 mph in ${withAbs.toFixed(1)} m (road tests: about 33–36 m)`);
  assert(locked > withAbs + 2, `locked wheels stop longer than anti-lock (${locked.toFixed(1)} m vs ${withAbs.toFixed(1)} m)`);
}

// Skid pad: steady cornering grip, and the car pushes (understeers) at the limit.
{
  const { car, inp } = fresh(10);
  inp.steer = 0.12;
  let best = 0;
  let front = 0;
  let rear = 0;
  for (let t = 0; t < 60; t += DT) {
    inp.throttle = Math.max(0, Math.min(1, (8 + t * 0.5 - car.vx) * 0.5));
    stepCar(car, inp, flat, DT);
    const lat = Math.abs(car.vx * car.yawRate) / 9.81;
    if (Math.abs(car.vy) < 0.08 * car.vx && lat > best) {
      best = lat;
      front = Math.abs(car.slipAngle[0]! + car.slipAngle[1]!) / 2;
      rear = Math.abs(car.slipAngle[2]! + car.slipAngle[3]!) / 2;
    }
    if (Math.abs(car.vy) > 6) break;
  }
  assert(best > 0.95 && best < 1.2, `steady cornering peaks at ${best.toFixed(2)} g on track tyres`);
  assert(front > rear, `front tyres work harder than the rears at the limit (${(front * 57.3).toFixed(1)}° vs ${(rear * 57.3).toFixed(1)}°)`);
}

// Weight moves: braking loads the front, cornering loads the outside.
{
  const { car, inp } = fresh(30);
  inp.brake = 0.8;
  for (let i = 0; i < 240; i += 1) stepCar(car, inp, flat, DT);
  assert(car.load[0]! + car.load[1]! > (car.load[2]! + car.load[3]!) * 1.6, "braking shifts load to the front axle");
  assert(car.pitch > 0, "the nose dives under braking");
  const b = fresh(22);
  b.inp.steer = 0.1;
  b.inp.throttle = 0.3;
  for (let i = 0; i < 480; i += 1) stepCar(b.car, b.inp, flat, DT);
  assert(b.car.yawRate > 0 && b.car.load[1]! > b.car.load[0]! * 1.5 && b.car.load[3]! > b.car.load[2]! * 1.5, "a left turn loads the right-hand tyres");
}

// Wheelspin and lock-up exist, and the aids stop them.
{
  const spin = fresh();
  spin.inp.throttle = 1;
  spin.inp.tractionControl = false;
  let maxSlip = 0;
  for (let i = 0; i < 480; i += 1) {
    stepCar(spin.car, spin.inp, flat, DT);
    maxSlip = Math.max(maxSlip, spin.car.slipRatio[2]!);
  }
  assert(maxSlip > 0.3, `a full-throttle launch without traction control spins the rear tyres (slip ${maxSlip.toFixed(2)})`);
  const lock = fresh(30);
  lock.inp.brake = 1;
  lock.inp.abs = false;
  for (let i = 0; i < 240; i += 1) stepCar(lock.car, lock.inp, flat, DT);
  assert(lock.car.omega[0]! < 1 && carSpeed(lock.car) > 15, "without anti-lock the front wheels lock while the car is still moving");
}

// Grass has far less grip and drags the car down.
{
  const road = fresh(30);
  const grass = fresh(30);
  const lawn = buildSimTrack({ id: "lawn", name: "", location: "", origin: { lat: 0, lon: 0 }, lengthM: 0, pts: ring, grid: null });
  lawn.halfWidth = 0.01;
  lawn.kerb = 0.01;
  placeCar(grass.car, lawn, 10, 6, 30);
  for (let i = 0; i < 480 * 3; i += 1) {
    stepCar(road.car, road.inp, flat, DT);
    stepCar(grass.car, grass.inp, lawn, DT);
  }
  assert(grass.car.wheelsOff === 4 && carSpeed(grass.car) < carSpeed(road.car) - 2, "coasting on grass slows the car far more than on the road");
}

// Reverse: the automatic picks it when you hold the brake at a standstill.
{
  const { car, inp } = fresh(0);
  const state = createControlState();
  const raw: RawControls = { steer: 0, throttle: 0, brake: 1, analog: false, shiftUp: false, shiftDown: false };
  for (let f = 0; f < 240; f += 1) {
    shapeControls(state, raw, DEFAULT_ASSISTS, car, 1 / 60, inp);
    for (let k = 0; k < 8; k += 1) {
      stepCar(car, inp, flat, DT);
      inp.shift = 0;
    }
  }
  assert(car.gear === -1 && car.vx < -1, `holding the brake from a stop reverses (${car.vx.toFixed(1)} m/s)`);
  assert(usefulLock(fresh(2).car) === 1, "full lock is available at walking pace");
  const fast = fresh(40);
  assert(usefulLock(fast.car) < 0.35, "key steering is limited to a usable angle at speed");
}

// ── Laps: the test driver laps cleanly and close to the real time ──
const real = bundledRealLap("thunderhill-west");
assert(real && real.timeMs === 94801, "the real lap is bundled at its true time");
const ses = createSession(track, ND_MIATA, 150, 0);
const pilot = createPilot(track, ND_MIATA, 0.98);
const inp = blankInput();
const laps: number[] = [];
let maxOff = 0;
let frames = 0;
while (ses.lap < 3 && frames < 60 * 400) {
  pilotInput(pilot, ses, inp);
  stepSession(ses, inp);
  frames += 1;
  maxOff = Math.max(maxOff, Math.abs(ses.car.hit.d));
  if (ses.lapDone) {
    assert(ses.lastLapValid, "the test driver's lap is within track limits");
    laps.push(ses.lastLapMs);
  }
}
assert(laps.length === 2, "two flying laps were timed");
assert(maxOff < track.halfWidth, `the test driver stays on the asphalt (max ${maxOff.toFixed(1)} m from the line)`);
const lapS = laps[1]! / 1000;
assert(lapS > 90 && lapS < 101, `lap time ${lapS.toFixed(2)} s is within about 6% of the real 94.80 s`);
assert(Math.abs(laps[1]! - laps[0]!) < 1500, "flying laps repeat");
assert(ses.bestLapMs === Math.min(...laps) && ses.bestRecording.length > 600, "the best lap is recorded for the ghost");

// Deterministic: the same inputs give the same lap.
{
  const again = createSession(track, ND_MIATA, 150, 0);
  const p2 = createPilot(track, ND_MIATA, 0.98);
  const i2 = blankInput();
  let f = 0;
  while (again.lap < 2 && f < 60 * 300) {
    pilotInput(p2, again, i2);
    stepSession(again, i2);
    f += 1;
  }
  assert(Math.abs(again.lastLapMs - laps[0]!) < 1e-6, "the sim is deterministic");
}

// Track limits and reset.
{
  const off = createSession(track, ND_MIATA, 30, 20);
  const i3 = blankInput();
  i3.throttle = 0.5;
  for (let f = 0; f < 60 * 3; f += 1) stepSession(off, i3);
  assert(off.started, "the lap starts at the line");
  i3.steer = 0.5;
  for (let f = 0; f < 60 * 6 && off.lapValid; f += 1) stepSession(off, i3);
  assert(!off.lapValid, "four wheels off the track voids the lap");
  resetToTrack(off);
  assert(Math.abs(off.car.hit.d) < 0.5 && carSpeed(off.car) === 0, "reset puts the car back on the road, stopped");
}

// ── Ghosts: the real lap at its real speed, and your own best ──
const ghost = ghostFromRealLap(track, real);
assert(ghost && ghost.kind === "real" && ghost.lapMs === 94801, "the real ghost keeps the real lap time (no scaling)");
{
  const pose: GhostPose = { x: 0, y: 0, z: 0, heading: 0, speed: 0 };
  const cursor = { k: 0 };
  let fastest = 0;
  let slowest = Infinity;
  let far = 0;
  const hit = { i: 0, s: 0, d: 0 };
  for (let ms = 2000; ms < 93000; ms += 500) {
    assert(ghostPose(ghost, track, ms, cursor, pose), "the ghost has a pose all lap");
    fastest = Math.max(fastest, pose.speed);
    slowest = Math.min(slowest, pose.speed);
    projectOnTrack(track, pose.x, pose.y, hit, true);
    far = Math.max(far, Math.abs(hit.d));
  }
  assert(mph(fastest) > 80 && mph(fastest) < 95 && mph(slowest) > 20 && mph(slowest) < 35, `ghost speeds are the real ones (${mph(slowest).toFixed(0)}–${mph(fastest).toFixed(0)} mph)`);
  assert(far < 1.5, "the ghost drives the real line");
  assert(!ghostPose(ghost, track, 95000, cursor, pose), "the ghost stops at the end of its lap");
  assert(Math.abs(ghostDelta(ghost, 0, 0)) < 0.2 && Math.abs(ghostDelta(ghost, track.n - 1, 94801)) < 0.3, "delta is zero when level with the ghost");
  assert(ghostDelta(ghost, Math.floor(track.n / 2), ghost.timeAtIndex[Math.floor(track.n / 2)]! + 1500) > 1.4, "being later than the ghost shows a positive delta");
}
{
  const mine = ghostFromRecording(track, ses.bestRecording, "Your best");
  assert(mine && Math.abs(mine.lapMs - ses.bestLapMs) < 1, "your best lap becomes a ghost with your lap time");
  let prev = -1;
  for (let i = 0; i < track.n; i += 1) {
    assert(mine.timeAtIndex[i]! >= prev - 1e-3, "ghost time increases round the lap");
    prev = mine.timeAtIndex[i]!;
  }
}

console.log(`verify-sim: ok (lap ${lapS.toFixed(2)} s vs real 94.80 s)`);
