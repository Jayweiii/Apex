/**
 * Apex Kart rebuild: heading stick, drift boost, real altitude, ghost laps.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ghostFromSamples, referenceGhost, sampleGhost, emptyGhostPose } from "../src/lib/kart2/ghost";
import { KART2_LEVELS } from "../src/lib/kart2/levels";
import { ghostFromUpload } from "../src/lib/kart2/load-ghost";
import {
  liveryStats,
  parseLivery,
  serializeLivery,
  type Livery,
} from "../src/lib/kart2/livery";
import { leftTurn } from "../src/lib/kart2/math";
import {
  createKart,
  neutralInput,
  stepKart,
  DT,
  type Kart2Input,
  type Kart2State,
} from "../src/lib/kart2/physics";
import { chaseCamYaw, STICK_RADIUS, stickCommand } from "../src/lib/kart2/stick";
import { buildTrack, type Kart2Track } from "../src/lib/kart2/track";
import { THUNDERHILL_WEST_ALT_M } from "../src/lib/kart2/levels/thunderhill-west";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
const west = buildTrack(KART2_LEVELS[0]!);
const stats = liveryStats(parseLivery(null));

// ── Stick: screen-left is a left heading, magnitude is throttle ──
{
  const cam = 0.4;
  const left = stickCommand(-STICK_RADIUS, 0, cam);
  assert(left.active && left.throttle > 0.95, "full stick is full throttle");
  const turned = leftTurn(cam, left.heading);
  assert(turned > 1.4 && turned < 1.75, `screen-left faces left of the camera (${turned.toFixed(3)})`);
  const ahead = stickCommand(0, -STICK_RADIUS, cam);
  assert(Math.abs(leftTurn(cam, ahead.heading)) < 0.05, "stick up faces the camera");
  assert(ahead.throttle > 0.95, "stick up is full throttle");
  const dead = stickCommand(2, -2, cam);
  assert(!dead.active && dead.throttle === 0, "dead zone releases the stick");
}

// ── Holding screen-left turns the kart left and it always drives forward ──
{
  const kart = createKart(west, stats);
  let cam = kart.heading;
  const h0 = kart.heading;
  let minFwd = Infinity;
  for (let i = 0; i < 90; i += 1) {
    const cmd = stickCommand(-STICK_RADIUS, 0, cam);
    const prevAngle = i === 0 ? cmd.heading : stickCommand(-STICK_RADIUS, 0, cam).heading;
    const input: Kart2Input = {
      active: true,
      heading: cmd.heading,
      throttle: cmd.throttle,
      stickOmega: 0,
      drift: false,
    };
    void prevAngle;
    stepKart(kart, input, west, DT);
    cam = chaseCamYaw(cam, kart.heading, kart.slip, DT);
    const fx = Math.sin(kart.heading);
    const fy = Math.cos(kart.heading);
    minFwd = Math.min(minFwd, kart.vx * fx + kart.vy * fy);
  }
  assert(kart.turnedLeft > 0.7, `screen-left turns left (${kart.turnedLeft.toFixed(2)} rad)`);
  assert(kart.speed > 6, `stick moves the kart (${kart.speed.toFixed(1)} m/s)`);
  assert(minFwd > -0.2, "the kart does not drive in reverse");
}

// ── Releasing the stick brakes to a stop ──
{
  const kart = createKart(west, stats);
  kart.vx = Math.sin(kart.heading) * 18;
  kart.vy = Math.cos(kart.heading) * 18;
  for (let i = 0; i < 90; i += 1) stepKart(kart, neutralInput(kart.heading), west, DT);
  assert(kart.speed < 1, `release brakes (${kart.speed.toFixed(2)} m/s)`);
}

// ── Sharp direction change at speed drifts, then straightening boosts ──
{
  const kart = createKart(west, stats);
  const h = kart.heading;
  kart.vx = Math.sin(h) * 16;
  kart.vy = Math.cos(h) * 16;
  let cam = h;
  const input: Kart2Input = {
    active: true,
    heading: h - 1.1,
    throttle: 1,
    stickOmega: 0,
    drift: false,
  };
  for (let i = 0; i < 80; i += 1) {
    input.heading = cam - 1.1;
    stepKart(kart, input, west, DT);
    cam = chaseCamYaw(cam, kart.heading, kart.slip, DT);
  }
  assert(kart.drifting, "a sharp heading change at speed starts a drift");
  assert(kart.charge > 0.15, `drift builds the boost meter (${kart.charge.toFixed(2)})`);
  for (let i = 0; i < 30; i += 1) {
    input.heading = kart.heading;
    input.stickOmega = 0;
    stepKart(kart, input, west, DT);
  }
  assert(!kart.drifting, "straightening ends the drift");
  assert(kart.boost > 0, `releasing a charged drift boosts (${kart.boost.toFixed(2)} s)`);
}

// ── A flick of the stick also initiates the drift ──
{
  const kart = createKart(west, stats);
  const h = kart.heading;
  kart.vx = Math.sin(h) * 16;
  kart.vy = Math.cos(h) * 16;
  stepKart(
    kart,
    { active: true, heading: h - 0.55, throttle: 0.8, stickOmega: 6, drift: false },
    west,
    DT,
  );
  assert(kart.drifting, "a flick at speed starts a drift");
}

// ── Real Thunderhill altitude: climbs cost speed, descents give it back ──
{
  const lo = Math.min(...THUNDERHILL_WEST_ALT_M);
  const hi = Math.max(...THUNDERHILL_WEST_ALT_M);
  assert(hi - lo > 18 && lo < 90 && hi > 100, `USGS relief is real (${lo.toFixed(1)}–${hi.toFixed(1)} m)`);
  assert(west.level.surveyedElevation, "west elevation is surveyed");
  const rise = Math.max(...west.pz) - Math.min(...west.pz);
  assert(rise > 8, `playable hills are tall (${rise.toFixed(1)} m)`);

  function coast(index: number): number {
    const kart = createKart(west, stats);
    const h = Math.atan2(west.tx[index]!, west.ty[index]!);
    kart.x = west.px[index]!;
    kart.y = west.py[index]!;
    kart.heading = h;
    kart.vx = Math.sin(h) * 14;
    kart.vy = Math.cos(h) * 14;
    kart.hit.index = index;
    const input: Kart2Input = {
      active: true,
      heading: h,
      throttle: 0.22,
      stickOmega: 0,
      drift: false,
    };
    for (let i = 0; i < 120; i += 1) {
      input.heading = kart.heading;
      stepKart(kart, input, west, DT);
    }
    return kart.speed;
  }
  let up = 0;
  let down = 0;
  let upG = -Infinity;
  let downG = Infinity;
  for (let i = 0; i < west.count; i += 1) {
    if (Math.abs(west.curv[i]!) > 0.06) continue;
    if (west.grade[i]! > upG) {
      upG = west.grade[i]!;
      up = i;
    }
    if (west.grade[i]! < downG) {
      downG = west.grade[i]!;
      down = i;
    }
  }
  assert(upG > 0.03 && downG < -0.03, `found a climb and a descent (${upG.toFixed(3)}, ${downG.toFixed(3)})`);
  const upSpeed = coast(up);
  const downSpeed = coast(down);
  assert(
    downSpeed > upSpeed + 1.5,
    `downhill keeps more speed (${downSpeed.toFixed(1)} vs climb ${upSpeed.toFixed(1)})`,
  );
}

// ── Every circuit is a closed lap with altitude ──
for (const level of KART2_LEVELS) {
  const track = buildTrack(level);
  const z = Math.max(...track.pz) - Math.min(...track.pz);
  assert(track.length > 700 && track.length < 2800, `${level.id} length ${track.length.toFixed(0)} m`);
  assert(z > 4, `${level.id} is not flat (${z.toFixed(1)} m)`);
  assert(track.count > 40, `${level.id} has a sampled centreline`);
}

// ── Telemetry ghost sits on the racing line; a foreign lap is refused ──
{
  const samples = [];
  for (let i = 0; i < west.level.latLon.length; i += 2) {
    const [lat, lon] = west.level.latLon[i]!;
    samples.push({ t: i * 0.4, lat, lon });
  }
  const ghost = ghostFromSamples(west, samples, "trace");
  assert(ghost, "a lap on the circuit becomes a ghost");
  const pose = emptyGhostPose();
  sampleGhost(ghost!, ghost!.duration * 0.5, pose);
  assert(pose.active, "ghost samples");
  let best = Infinity;
  for (let i = 0; i < west.count; i += 1) {
    best = Math.min(best, Math.hypot(west.px[i]! - pose.x, west.py[i]! - pose.y));
  }
  assert(best < 18, `ghost stays on the road (${best.toFixed(1)} m)`);

  const foreign = ghostFromSamples(
    west,
    [
      { t: 0, lat: 34.87, lon: -118.26 },
      { t: 1, lat: 34.871, lon: -118.261 },
      { t: 2, lat: 34.872, lon: -118.262 },
      { t: 3, lat: 34.873, lon: -118.26 },
      { t: 4, lat: 34.874, lon: -118.259 },
      { t: 5, lat: 34.873, lon: -118.258 },
      { t: 6, lat: 34.872, lon: -118.257 },
      { t: 7, lat: 34.871, lon: -118.258 },
    ],
    "elsewhere",
  );
  assert(foreign === null, "a lap from another venue is not used as a ghost");
}

// ── Reference ghost completes the lap ──
{
  const ghost = referenceGhost(west);
  const a = emptyGhostPose();
  const b = emptyGhostPose();
  sampleGhost(ghost, 0.2, a);
  sampleGhost(ghost, 3, b);
  assert(a.active && b.active && Math.hypot(a.x - b.x, a.y - b.y) > 20, "reference ghost drives");
}

// ── Uploaded TrackAddict CSV is parsed; wrong-track files explain themselves ──
{
  const csv = readFileSync(
    resolve(import.meta.dirname, "../src/lib/fixtures/trackaddict-snippet.csv"),
    "utf8",
  );
  const file = new File([csv], "session.csv", { type: "text/csv" });
  const loaded = await ghostFromUpload(file, west);
  assert(!loaded.ok, "east-side snippet is not a west ghost");
  if (!loaded.ok) assert(/track/i.test(loaded.error), loaded.error);
}

// ── Livery round-trips and changes the kart ──
{
  const livery: Livery = { color: "sky", pattern: "flames", body: "wedge", wheels: "gold" };
  const back = parseLivery(serializeLivery(livery));
  assert(
    back.color === "sky" && back.pattern === "flames" && back.body === "wedge" && back.wheels === "gold",
    "livery survives storage",
  );
  assert(parseLivery("{").color === "apex", "bad livery falls back");
  const wide = liveryStats({ ...livery, body: "wide", wheels: "slick" });
  const wedge = liveryStats({ ...livery, body: "wedge", wheels: "slick" });
  assert(wide.grip > wedge.grip && wedge.speed > wide.speed, "body options change grip and speed");
}

// Touch the state type so a forgotten field fails the build of this script.
const _probe: Kart2State = createKart(west, stats);
void _probe;

console.log(
  JSON.stringify({
    ok: true,
    tracks: KART2_LEVELS.map((level) => {
      const track: Kart2Track = buildTrack(level);
      return {
        id: level.id,
        length: Math.round(track.length),
        relief: Math.round(Math.max(...track.pz) - Math.min(...track.pz)),
      };
    }),
  }),
);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
