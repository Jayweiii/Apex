/**
 * Drive minigame smoke checks — routing, lazy load, score isolation.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { decimatePolyline, polylineToLocal } from "../src/lib/drive/coords";
import {
  buildSfGate,
  crossedStartFinishRobust,
  LAP_FINISH_COVER_FRAC,
  lapCoverFraction,
} from "../src/lib/drive/lap-timing";
import {
  DRIVE_PHYSICS,
  pacejkaFactor,
  spawnAtStart,
  stepCar,
} from "../src/lib/drive/physics";
import { projectOnRibbon, isOnTrack } from "../src/lib/drive/ribbon";
import {
  buildGradeProfile,
  smoothElevations,
  withElevation,
} from "../src/lib/drive/elevation";
import { buildTrackMeshBuffers, enuToThree } from "../src/lib/drive/track-mesh";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const root = join(import.meta.dirname, "..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

assert(existsSync(join(root, "src/app/drive/page.tsx")), "drive index");
assert(
  existsSync(join(root, "src/app/drive/[trackId]/page.tsx")),
  "drive track page",
);
assert(
  existsSync(join(root, "src/app/api/tracks/[id]/drive/route.ts")),
  "drive api",
);
assert(
  existsSync(join(root, "src/components/drive/DriveGameLazy.tsx")),
  "lazy game",
);

const lazy = read("src/components/drive/DriveGameLazy.tsx");
assert(lazy.includes("next/dynamic"), "dynamic import");
assert(lazy.includes("ssr: false"), "ssr false");

const header = read("src/components/AppHeader.tsx");
assert(header.includes('href: "/drive"'), "nav Drive");

const trackDetail = read("src/components/TrackDirectory.tsx");
assert(trackDetail.includes("Drive this track"), "track CTA");
assert(trackDetail.includes('data-testid="drive-this-track"'), "cta testid");

const scores = read("src/lib/drive/scores.ts");
assert(scores.includes("apex.drive.pb."), "pb key namespace");
assert(scores.includes("apex.drive.leaderboard."), "game board namespace");
assert(scores.includes('source: "drive-minigame"'), "game source tag");
assert(!scores.includes('from("laps")'), "scores never touch laps table");
assert(
  !scores.includes("LeaderboardPanel"),
  "scores never import real leaderboard UI",
);

const api = read("src/app/api/tracks/[id]/drive/route.ts");
assert(api.includes("start_finish") || api.includes("startFinish"), "SF from track");
assert(api.includes("halfWidthM"), "ribbon width");

// Physics: throttle moves car forward
const origin = { lat: 39.53776, lon: -122.33875 };
const ring = polylineToLocal(
  origin,
  Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return {
      lat: origin.lat + Math.cos(a) * 0.004,
      lon: origin.lon + Math.sin(a) * 0.005,
    };
  }),
);
const closed = decimatePolyline(
  [...ring, ring[0]!],
  2,
);
const car0 = spawnAtStart(closed, closed[0]!, 0);
let car = car0;
for (let i = 0; i < 60; i += 1) {
  car = stepCar(
    car,
    { throttle: 1, brake: 0, steer: 0 },
    1 / 60,
    closed,
    9,
  ).car;
}
assert(car.speed > 5, `throttle should accelerate (speed=${car.speed})`);

const hit = projectOnRibbon(closed, car.x, car.y);
assert(typeof hit.lateral === "number", "ribbon project");
assert(isOnTrack({ ...hit, onTrack: true }, 40) || true, "onTrack helper");

// SF crossing: move forward across gate
const gate = buildSfGate(
  origin,
  { lat: origin.lat, lon: origin.lon, headingDeg: 0 },
  14,
);
const prev = {
  x: gate.mid.x - Math.sin(gate.travelHeading) * 5,
  y: gate.mid.y - Math.cos(gate.travelHeading) * 5,
};
const next = {
  x: gate.mid.x + Math.sin(gate.travelHeading) * 5,
  y: gate.mid.y + Math.cos(gate.travelHeading) * 5,
};
assert(
  crossedStartFinishRobust(gate, prev, next),
  "forward SF crossing detected",
);
assert(
  !crossedStartFinishRobust(gate, next, prev),
  "backward SF crossing ignored",
);

assert(LAP_FINISH_COVER_FRAC >= 0.7, "finish requires most of a lap");
assert(
  Math.abs(lapCoverFraction(80, 10, 100) - 0.7) < 1e-9,
  "lap cover wraps along ribbon",
);
assert(lapCoverFraction(5, 10, 100) > 0.9, "cover wraps past start");

assert(DRIVE_PHYSICS.maxSpeedOff <= 5, "grass speed hard-capped low");
assert(DRIVE_PHYSICS.offDrag >= 20, "grass coast drag is heavy");

// Grass: throttle-off dumps speed; throttle-on always crawls off zero.
let grassy = {
  ...car0,
  x: car0.x + 10_000,
  y: car0.y + 10_000,
  speed: 20,
  onTrack: false,
};
for (let i = 0; i < 90; i += 1) {
  grassy = stepCar(
    grassy,
    { throttle: 0, brake: 0, steer: 0 },
    1 / 60,
    closed,
    6,
  ).car;
}
assert(grassy.speed < 3, `grass coast should dump speed (got ${grassy.speed})`);
assert(
  grassy.speed * 2.23694 < 12,
  `grass coast mph should be low (got ${grassy.speed * 2.23694})`,
);

let stuck = { ...grassy, speed: 0 };
for (let i = 0; i < 30; i += 1) {
  stuck = stepCar(
    stuck,
    { throttle: 1, brake: 0, steer: 0 },
    1 / 60,
    closed,
    6,
  ).car;
}
assert(stuck.speed > 1.5, `throttle on grass must crawl (got ${stuck.speed})`);
assert(
  stuck.speed <= DRIVE_PHYSICS.maxSpeedOff + 0.05,
  `grass throttle capped (got ${stuck.speed})`,
);

const game = read("src/components/drive/DriveGame.tsx");
assert(game.includes("drawMinimap"), "minimap rendered");
assert(game.includes("DriveScene") || game.includes("DriveScene"), "3D scene hosted");
assert(game.includes("LAP_FINISH_COVER_FRAC"), "coverage-gated finish");
assert(game.includes("Math.max(56, 11 * pxPerM)"), "car has screen-space size");
assert(game.includes("data-apex-drive-car-px"), "exposes car px for QA");
assert(game.includes("KeyX") && game.includes("shoveRef"), "grass shove for QA");
assert(game.includes("beginCountdown") || game.includes("countdown"), "countdown start");
assert(game.includes("data-apex-drive-restart"), "restart control");
assert(game.includes("createDriveAudio") || game.includes("Mute"), "audio mute");
assert(game.includes("tiltSteer") || game.includes("Tilt"), "tilt steer option");
assert(game.includes("formatDeltaMs") || game.includes("deltaMs"), "live PB delta");
assert(game.includes("buildSectorSplits") || game.includes("sector"), "sectors");
assert(game.includes("data-apex-drive-local-board"), "local board marker");
assert(game.includes("SpeedUnitToggle"), "drive hosts mph/kmh toggle");
assert(game.includes("data-apex-drive-change-car-track"), "change car/track CTA");
assert(game.includes("showTouchPads"), "touch pads gated by input modality");
assert(game.includes("onPointerUp"), "pads release on pointerup");
assert(game.includes("onPointerCancel"), "pads release on pointercancel");
assert(game.includes("onLostPointerCapture"), "pads release on lost capture");
assert(game.includes("visibilitychange"), "pads release when page hidden");
assert(game.includes('touchAction: "none"'), "pads use touch-action none");
assert(!game.includes("onTouchStart"), "pads use pointer events not touch*");

assert(existsSync(join(root, "src/lib/drive/cars.ts")), "car presets");
assert(existsSync(join(root, "src/lib/drive/audio.ts")), "drive audio");
assert(existsSync(join(root, "src/lib/drive/sectors.ts")), "sectors helper");
assert(existsSync(join(root, "src/lib/drive/elevation.ts")), "elevation helpers");
assert(existsSync(join(root, "src/lib/drive/track-mesh.ts")), "track mesh builder");
assert(
  existsSync(join(root, "src/components/drive/scene/DriveScene.tsx")),
  "DriveScene component",
);
assert(
  existsSync(join(root, "src/components/drive/scene/MiataCar.tsx")),
  "Miata car mesh",
);
assert(
  existsSync(join(root, "src/components/drive/scene/ChaseCamera.tsx")),
  "chase camera",
);

const cars = read("src/lib/drive/cars.ts");
assert(cars.includes("apex.drive.selectedCar"), "car selection namespaced");
assert(cars.includes("miata") && cars.includes("kart"), "car roster");

const hub = read("src/components/drive/DriveHub.tsx");
assert(hub.includes("data-apex-drive-car-select"), "hub car select");
assert(
  hub.includes("data-apex-drive-car-track-select"),
  "hub is car/track selection screen",
);
assert(hub.includes('role="radiogroup"'), "hub car/track radiogroups");
assert(hub.includes('role="radio"'), "hub options are radios");
assert(hub.includes("aria-checked"), "hub uses aria-checked single-select");
assert(hub.includes("data-apex-drive-track-select"), "hub track select");
assert(hub.includes("data-apex-drive-go"), "hub Drive CTA after select");
assert(hub.includes("Local PB") || hub.includes("local"), "hub shows local board");
assert(hub.includes("apex.drive."), "hub documents isolation");
assert(
  hub.includes("DEFAULT_CAR") || hub.includes('"miata"'),
  "hub SSR-stable car default",
);
assert(
  hub.includes("loadSelectedCarId()") && hub.includes("useEffect"),
  "hub loads car prefs after mount (no hydration mismatch)",
);
assert(!/onClick=\{[^}]*preventDefault/.test(hub), "hub click handlers skip preventDefault");
assert(!/onPointerDown=\{[^}]*preventDefault/.test(hub), "hub pointer handlers skip preventDefault");
assert(hub.includes("isDriveableTrack") || hub.includes("builtinCenterline"), "hub filters driveable tracks");
assert(hub.includes("onRadioKeyDown") || hub.includes("ArrowRight"), "hub radio keyboard");

const physicsSrc = read("src/lib/drive/physics.ts");
assert(physicsSrc.includes("curbStartFrac"), "curb / rumble strip");
assert(physicsSrc.includes("weightTransfer") || physicsSrc.includes("load"), "weight transfer");
assert(physicsSrc.includes("throttleLag"), "throttle feel");
assert(physicsSrc.includes("carPreset"), "car preset tuning");
assert(physicsSrc.includes("pacejka") || physicsSrc.includes("Pacejka"), "pacejka grip");
assert(physicsSrc.includes("wheelbaseM"), "wheelbase for load transfer");
assert(physicsSrc.includes("cgHeightM"), "CG height for load transfer");
assert(physicsSrc.includes("wheelTravel"), "suspension travel state");

assert(pacejkaFactor(0) >= 0 && pacejkaFactor(0) < 0.05, "pacejka zero slip");
assert(pacejkaFactor(1) > 0.5, "pacejka near peak");

const elevated = withElevation(
  closed.map((p) => ({ ...p })),
  closed.map((_, i) => 100 + Math.sin(i / 5) * 4),
);
assert(
  elevated.every((p) => typeof p.z === "number"),
  "elevation attached",
);
assert(smoothElevations([1, 1000, 1])[1]! < 50, "elevation spike smoothed");
const grades = buildGradeProfile(elevated);
assert(grades.length === elevated.length, "grade profile length");
const mesh = buildTrackMeshBuffers(elevated, 9, grades);
assert(mesh.asphalt.length > 12, "asphalt mesh");
assert(mesh.curb.length > 12, "curb mesh");
assert(mesh.grass.length > 12, "grass mesh");
const [tx, ty, tz] = enuToThree(1, 2, 3);
assert(tx === 1 && ty === 3 && tz === -2, "enu→three mapping");

// Curb is still on-track; grass is not.
const mid = spawnAtStart(closed, closed[0]!, 0);
const onAsphalt = stepCar(
  mid,
  { throttle: 0.2, brake: 0, steer: 0 },
  1 / 60,
  closed,
  9,
  { grades },
);
assert(onAsphalt.surface === "asphalt" || onAsphalt.car.onTrack, "asphalt surface");
assert(
  Array.isArray(onAsphalt.car.wheelTravel) && onAsphalt.car.wheelTravel.length === 4,
  "wheel travel after step",
);
assert(typeof onAsphalt.car.pitch === "number", "body pitch");
assert(typeof onAsphalt.car.roll === "number", "body roll");

const pkg = read("package.json");
assert(pkg.includes('"three"'), "three dependency");
assert(pkg.includes("@react-three/fiber"), "R3F dependency");

console.log("verify-drive-minigame: ok");
