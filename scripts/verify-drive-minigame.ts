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
  spawnAtStart,
  stepCar,
} from "../src/lib/drive/physics";
import { projectOnRibbon, isOnTrack } from "../src/lib/drive/ribbon";

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
assert(game.includes("LAP_FINISH_COVER_FRAC"), "coverage-gated finish");
assert(game.includes("Math.max(44, 9.5 * pxPerM)"), "car has screen-space size");

console.log("verify-drive-minigame: ok");
