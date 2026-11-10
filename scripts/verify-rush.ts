/**
 * Apex Rush contracts: tracks, stick, drift, hills, races and ghosts.
 * Pure sim, no DOM. Run with `npm test -- rush`.
 */
import { statsFor, DEFAULT_LOOK, loadLook, BODIES, WHEELS } from "../src/lib/rush/garage";
import { bundledRealLap, ghostFromRealLap, ghostFromRecording, ghostPose, GHOST_PACE } from "../src/lib/rush/ghost";
import { DRIFT_EDGE, STICK_RADIUS, stickInput, type StickInput } from "../src/lib/rush/input";
import { BASE_STATS, BOOST_SECONDS, createKart, DT, stepKart, type KartInput } from "../src/lib/rush/kart";
import { RUSH_LEVELS } from "../src/lib/rush/levels";
import { autopilot, createRace, stepRace } from "../src/lib/rush/race";
import { buildRushTrack, poseAt, projectOnTrack, type RushTrack } from "../src/lib/rush/track";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const tracks = new Map<string, RushTrack>();
for (const level of RUSH_LEVELS) tracks.set(level.id, buildRushTrack(level.data));

// ── Tracks: drivable at kart width, with real (capped) hills ──
for (const [id, t] of tracks) {
  let maxCurv = 0;
  let maxGrade = 0;
  for (let i = 0; i < t.n; i += 1) {
    maxCurv = Math.max(maxCurv, Math.abs(t.curv[i]!));
    maxGrade = Math.max(maxGrade, Math.abs(t.grade[i]!));
  }
  assert(t.length > 800 && t.length < 2300, `${id}: game length is kart-sized (${t.length.toFixed(0)} m)`);
  assert(1 / maxCurv > t.halfWidth + 1, `${id}: tightest corner (${(1 / maxCurv).toFixed(1)} m) is wider than the half width`);
  assert(maxGrade <= 0.14, `${id}: steepest grade is capped (${(maxGrade * 100).toFixed(1)}%)`);
  assert(t.data.grid !== null && t.data.grid.z.length === t.data.grid.nx * t.data.grid.ny, `${id}: has a real terrain grid`);
  // No two different parts of the lap overlap.
  let minSep = Infinity;
  for (let i = 0; i < t.n; i += 2) {
    for (let j = i + 40; j < t.n; j += 2) {
      if (t.n - j + i < 40) continue;
      minSep = Math.min(minSep, Math.hypot(t.px[i]! - t.px[j]!, t.py[i]! - t.py[j]!));
    }
  }
  assert(minSep > 2 * t.halfWidth, `${id}: separate sections of track don't overlap (${minSep.toFixed(1)} m apart)`);
  // The loop closes.
  const gap = Math.hypot(t.px[0]! - t.px[t.n - 1]!, t.py[0]! - t.py[t.n - 1]!);
  assert(gap < t.spacing * 1.5, `${id}: outline is a closed loop`);
  assert(t.pads.length >= 1 && t.boxes.length === 12, `${id}: has boost pads and item boxes`);
}
assert(tracks.get("thunderhill-west")!.relief > 12, "Thunderhill West has real hills");
assert(tracks.get("buttonwillow-13cw")!.relief < tracks.get("thunderhill-west")!.relief, "Buttonwillow is flatter than Thunderhill");

// ── Touch stick ──
{
  const scratch: StickInput = { steer: 0, brake: 0, drift: false };
  // A fresh copy per reading, so one assert doesn't narrow the next.
  const read = (dx: number, dy: number, drifting: number): StickInput => ({ ...stickInput(dx, dy, drifting, scratch) });
  let so = read(0, 0, 0);
  const R = STICK_RADIUS;
  assert(so.steer === 0 && !so.drift && so.brake === 0, "centred stick does nothing");
  so = read(R * 0.5, 0, 0);
  assert(so.steer > 0.3 && so.steer < 0.7 && !so.drift, "half right steers right without drifting");
  so = read(-R * 0.5, 0, 0);
  assert(so.steer < -0.3, "half left steers left");
  so = read(R * (DRIFT_EDGE + 0.02), 0, 0);
  assert(so.drift && so.steer > 0, "pushing to the edge starts a drift");
  so = read(R * 3, 0, 0);
  assert(so.drift && so.steer === 1, "past the edge clamps");
  so = read(R * 0.5, 0, 1);
  assert(so.drift, "easing back to half keeps a running drift");
  so = read(R, 0, 1);
  const tight = so.steer;
  so = read(R * 0.4, 0, 1);
  assert(tight > so.steer, "more stick = tighter drift");
  so = read(R * 0.1, 0, 1);
  assert(!so.drift, "returning to centre lets the drift go");
  so = read(-R * 0.6, 0, 1);
  assert(!so.drift && so.steer < 0, "crossing to the other side lets the drift go");
  so = read(0, R * 0.8, 0);
  assert(so.brake === 1 && !so.drift, "pulling down brakes");
}

// ── Drift: hold to charge, release to boost ──
{
  const t = tracks.get("buttonwillow-13cw")!;
  const k = createKart(0, { ...BASE_STATS });
  // A long straight: place the kart and get it up to speed.
  let si = 0;
  let run = 0;
  for (let i = 0; i < t.n; i += 1) {
    if (Math.abs(t.curv[i]!) < 0.003) {
      run += 1;
      if (run > 60) {
        si = i - 60;
        break;
      }
    } else run = 0;
  }
  const pose = poseAt(t, si * t.spacing, 0);
  k.x = pose.x;
  k.y = pose.y;
  k.heading = pose.heading;
  k.va = pose.heading;
  k.v = 22;
  k.hit.i = pose.i;
  const inp: KartInput = { steer: 0, throttle: 1, brake: 0, drift: false, useItem: false };
  stepKart(k, inp, t);
  inp.steer = 1;
  inp.drift = true;
  let started = false;
  let level = 0;
  // Long enough to charge, short enough to stay on the road.
  for (let i = 0; i < 40; i += 1) {
    stepKart(k, inp, t);
    if (k.drifting === 1) started = true;
    level = Math.max(level, k.chargeLevel);
  }
  assert(k.drifting === 1 && !k.offroad, "the drift is still held on the road");
  assert(started, "drift starts when the drift input and steering are held at speed");
  assert(level >= 1, `holding the drift charges the mini-turbo (level ${level})`);
  inp.drift = false;
  inp.steer = 0;
  stepKart(k, inp, t);
  const after: number = k.drifting; // re-read: the assert above narrowed it to 1
  assert(after === 0 && k.boostT > 0, "releasing a charged drift fires the boost");
  assert(Math.abs(k.boostT - BOOST_SECONDS[level]!) < 0.05, "boost length matches the charge level");

  // A drift that isn't charged gives nothing.
  const k2 = createKart(1, { ...BASE_STATS });
  Object.assign(k2, { x: pose.x, y: pose.y, heading: pose.heading, va: pose.heading, v: 22 });
  k2.hit.i = pose.i;
  inp.steer = -1;
  inp.drift = true;
  for (let i = 0; i < 10; i += 1) stepKart(k2, inp, t);
  inp.drift = false;
  stepKart(k2, inp, t);
  assert(k2.boostT === 0, "a tap of drift gives no boost");

  // Too slow to drift.
  const k3 = createKart(2, { ...BASE_STATS });
  Object.assign(k3, { x: pose.x, y: pose.y, heading: pose.heading, va: pose.heading, v: 4 });
  k3.hit.i = pose.i;
  inp.steer = 1;
  inp.drift = true;
  inp.throttle = 0;
  for (let i = 0; i < 20; i += 1) stepKart(k3, inp, t);
  assert(k3.drifting === 0, "no drift at crawling speed");
}

// ── Hills: coasting downhill keeps more speed than uphill ──
{
  const t = tracks.get("thunderhill-west")!;
  let up = 0;
  let down = 0;
  for (let i = 0; i < t.n; i += 1) {
    if (t.grade[i]! > t.grade[up]!) up = i;
    if (t.grade[i]! < t.grade[down]!) down = i;
  }
  const coast = (i: number): number => {
    const k = createKart(0, { ...BASE_STATS });
    const pose = poseAt(t, i * t.spacing, 0);
    Object.assign(k, { x: pose.x, y: pose.y, heading: pose.heading, va: pose.heading, v: 15 });
    k.hit.i = pose.i;
    const inp: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
    for (let n = 0; n < 30; n += 1) stepKart(k, inp, t);
    return k.v;
  };
  const vUp = coast(up);
  const vDown = coast(down);
  assert(vDown > vUp + 0.3, `gravity acts on slopes (uphill ${vUp.toFixed(2)} m/s, downhill ${vDown.toFixed(2)} m/s)`);
}

// ── Walls: a kart aimed off the road stays inside the barrier ──
{
  const t = tracks.get("streets-of-willow-cw")!;
  const k = createKart(0, { ...BASE_STATS });
  const pose = poseAt(t, 100, 0);
  Object.assign(k, { x: pose.x, y: pose.y, heading: pose.heading + 1.2, va: pose.heading + 1.2, v: 20 });
  k.hit.i = pose.i;
  const inp: KartInput = { steer: 0, throttle: 1, brake: 0, drift: false, useItem: false };
  let maxD = 0;
  for (let n = 0; n < 240; n += 1) {
    stepKart(k, inp, t);
    maxD = Math.max(maxD, Math.abs(k.hit.d));
  }
  assert(maxD <= t.halfWidth + t.runoff + 0.01, `the wall holds the kart (${maxD.toFixed(2)} m from centre)`);
  assert(Number.isFinite(k.x) && Number.isFinite(k.v), "kart state stays finite after a wall hit");
}

// ── Races: every track can be finished, deterministically ──
const summary: Record<string, string> = {};
for (const [id, t] of tracks) {
  const run = () => {
    const w = createRace(t, "gp", { ...BASE_STATS });
    const inp: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
    for (let i = 0; i < 60 * 420 && !w.karts.every((k) => k.finished); i += 1) {
      autopilot(w, inp);
      stepRace(w, inp);
    }
    return w;
  };
  const a = run();
  const b = run();
  assert(a.karts.length === 6, `${id}: grid of six`);
  assert(a.karts.every((k) => k.finished), `${id}: every kart finishes the race`);
  assert(a.karts.every((k, i) => k.finishMs === b.karts[i]!.finishMs), `${id}: the race is deterministic`);
  const places = a.karts.map((k) => k.place).sort();
  assert(places.join() === "1,2,3,4,5,6", `${id}: places are 1 to 6`);
  const best = a.karts[0]!.bestLapMs / 1000;
  assert(best > 25 && best < 100, `${id}: lap time is game-sized (${best.toFixed(1)} s)`);
  assert(a.bestRec !== null && a.bestRec.length > 300, `${id}: the best lap was recorded for a ghost`);
  summary[id] = `${best.toFixed(1)}s x${a.laps}`;

  // Time trial: alone on track.
  const tt = createRace(t, "tt", { ...BASE_STATS });
  assert(tt.karts.length === 1, `${id}: time trial has no rivals`);
}

// ── Ghosts ──
{
  const t = tracks.get("thunderhill-west")!;
  const lap = bundledRealLap("thunderhill-west");
  assert(lap !== null, "Thunderhill West ships a real lap");
  const g = ghostFromRealLap(t, lap);
  assert(g !== null, "the real lap fits the track");
  assert(Math.abs(g.lapMs - lap.timeMs * t.scale * GHOST_PACE) < 1, "ghost lap time is the real time at kart scale");
  // It stays on the road all the way round and moves forward.
  const hit = { i: 0, s: 0, d: 0 };
  const pose = { x: 0, y: 0, z: 0, heading: 0 };
  let maxOff = 0;
  let prevS = -1;
  let wraps = 0;
  for (let ms = 0; ms <= g.lapMs; ms += 250) {
    assert(ghostPose(g, t, ms, hit, pose), "ghost has a pose for the whole lap");
    maxOff = Math.max(maxOff, Math.abs(hit.d));
    if (prevS >= 0 && hit.s < prevS - 50) wraps += 1;
    prevS = hit.s;
  }
  assert(maxOff < t.halfWidth + t.runoff, `the real-lap ghost stays within the track (${maxOff.toFixed(1)} m off centre at most)`);
  assert(wraps <= 1, "the ghost laps the track once, forwards");
  assert(!ghostPose(g, t, g.lapMs + 1000, hit, pose), "the ghost is hidden after its lap");
  for (let i = 1; i < t.n; i += 1) assert(g.timeAtIndex[i]! >= 0, "ghost timing covers the whole lap");
  // A lap from the wrong track is rejected.
  assert(ghostFromRealLap(tracks.get("buttonwillow-13cw")!, { ...lap, origin: tracks.get("buttonwillow-13cw")!.data.origin }) === null, "a lap that doesn't fit is rejected");

  // The player's own lap round-trips into a ghost.
  const w = createRace(t, "tt", { ...BASE_STATS });
  const inp: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false };
  for (let i = 0; i < 60 * 300 && !w.karts[0]!.finished; i += 1) {
    autopilot(w, inp);
    stepRace(w, inp);
  }
  const own = ghostFromRecording(t, w.bestRec!, w.bestRecMs, "Your best");
  assert(own !== null && Math.abs(own.lapMs - w.bestRecMs) < 1, "the player's best lap becomes a ghost");
}

// ── Garage ──
{
  const base = statsFor(DEFAULT_LOOK);
  for (const b of BODIES) {
    for (const wh of WHEELS) {
      const s = statsFor({ ...DEFAULT_LOOK, body: b.id, wheels: wh.id });
      assert(s.top > base.top * 0.9 && s.top < base.top * 1.1, `${b.id}/${wh.id}: top speed stays within 10% of base`);
      assert(s.accel > 0.7 && s.handling > 0.8 && s.drift > 0.7, `${b.id}/${wh.id}: no stat collapses`);
    }
  }
  assert(statsFor({ ...DEFAULT_LOOK, body: "wedge" }).top > base.top, "Wedge is faster");
  assert(statsFor({ ...DEFAULT_LOOK, wheels: "drift" }).drift > base.drift, "Drift wheels charge faster");
  assert(loadLook().body === DEFAULT_LOOK.body, "no storage → default kart");
}

void projectOnTrack;
void DT;
console.log(JSON.stringify({ ok: true, laps: summary }));
