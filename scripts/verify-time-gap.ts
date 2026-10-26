/**
 * Map gap label: time delta at the same distance (not t−t under time sync).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  sampleAtProgress,
  timeAtDistance,
  timeGapAtProgress,
  type GpsPoint,
} from "../src/lib/scrub";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ref: GpsPoint[] = [
  { t: 0, speed: 80, lat: 39.53, lon: -122.33, trackDist: 0 },
  { t: 10, speed: 100, lat: 39.531, lon: -122.331, trackDist: 200 },
  { t: 20, speed: 90, lat: 39.532, lon: -122.332, trackDist: 400 },
  { t: 40, speed: 70, lat: 39.534, lon: -122.334, trackDist: 800 },
];

// Other is 2s behind at every distance (reaches 200m at t=12, etc.).
const other: GpsPoint[] = [
  { t: 0, speed: 70, lat: 39.53, lon: -122.33, trackDist: 0 },
  { t: 12, speed: 90, lat: 39.531, lon: -122.331, trackDist: 200 },
  { t: 24, speed: 80, lat: 39.532, lon: -122.332, trackDist: 400 },
  { t: 48, speed: 60, lat: 39.534, lon: -122.334, trackDist: 800 },
];

const durationSec = 40;
const mid = sampleAtProgress(ref, 0.5, { basis: "time", durationSec });
assert(Math.abs(mid.t - 20) < 1e-6, `ref mid t=20 got ${mid.t}`);
assert(Math.abs((mid.trackDist ?? 0) - 400) < 1e-6, "ref mid dist 400");

const otherAt400 = timeAtDistance(other, 400);
assert(otherAt400 != null && Math.abs(otherAt400 - 24) < 1e-6, "other @400m = 24s");

const gap = timeGapAtProgress(ref, other, 0.5, {
  basis: "time",
  durationSec,
});
assert(gap != null && Math.abs(gap - 4) < 1e-6, `gap at mid should be +4s, got ${gap}`);

// Naive t−t under time sync is ~0 — that was the production bug.
const naive = sampleAtProgress(other, 0.5, { basis: "time", durationSec }).t - mid.t;
assert(Math.abs(naive) < 1e-6, "naive same-progress t delta is 0");

const root = resolve(import.meta.dirname, "..");
const chase = readFileSync(
  resolve(root, "src/components/ChaseTrackMap.tsx"),
  "utf8",
);
const leaflet = readFileSync(
  resolve(root, "src/components/LeafletTrackMap.tsx"),
  "utf8",
);
assert(chase.includes("timeGapAtProgress"), "chase map uses distance time gap");
assert(leaflet.includes("timeGapAtProgress"), "leaflet map uses distance time gap");
assert(!chase.includes("other.point.t - ref.point.t"), "chase dropped naive t−t");
assert(
  !leaflet.includes("other.point.t - ref.point.t"),
  "leaflet dropped naive t−t",
);

console.log("verify-time-gap ok", { gap });
