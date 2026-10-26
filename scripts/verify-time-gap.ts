/**
 * Map gap label: at shared time t, gap = t_ref(d_other) − t (not −elapsed).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  pathDistanceAtTime,
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

// Other is slower — reaches each distance ~20% later.
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

const otherMid = sampleAtProgress(other, 0.5, { basis: "time", durationSec });
assert(Math.abs(otherMid.t - 20) < 1e-6, "other mid t=20");
// At t=20 other is between 200@12 and 400@24 → dist ≈ 333.33m
assert(
  Math.abs((otherMid.trackDist ?? 0) - (200 + 200 * (8 / 12))) < 1e-6,
  `other mid dist, got ${otherMid.trackDist}`,
);

const gap = timeGapAtProgress(ref, other, 0.5, {
  basis: "time",
  durationSec,
});
// gap = t_ref(d_other) − t → ref reached ~333m at ~16.67s → ≈ −3.33s (behind)
assert(
  gap != null && Math.abs(gap - (10 + 10 * (8 / 12) - 20)) < 1e-6,
  `gap at mid should be ≈-3.33s, got ${gap}`,
);
assert(gap! < 0, "slower car is behind (negative)");

// Must NOT equal −elapsed (the production bug when trackDist invented as 0).
assert(Math.abs(gap! + 20) > 1, "gap is not −elapsed");

// Naive t−t under time sync is ~0.
const naive = otherMid.t - mid.t;
assert(Math.abs(naive) < 1e-6, "naive same-progress t delta is 0");

// No trackDist: path-distance fallback must still give a real gap (not −t).
const refRaw: GpsPoint[] = ref.map(({ trackDist: _td, ...p }) => p);
const otherRaw: GpsPoint[] = other.map(({ trackDist: _td, ...p }) => p);
const rawGap = timeGapAtProgress(refRaw, otherRaw, 0.5, {
  basis: "time",
  durationSec,
});
assert(rawGap != null && Number.isFinite(rawGap), "raw gap finite");
assert(Math.abs(rawGap! + 20) > 1, "raw gap is not −elapsed");
assert(
  pathDistanceAtTime(otherRaw, 20) > 50,
  "path distance at mid is real meters",
);

// All trackDist=0 must NOT be treated as usable (prod −elapsed bug).
const refZero: GpsPoint[] = refRaw.map((p) => ({ ...p, trackDist: 0 }));
const otherZero: GpsPoint[] = otherRaw.map((p) => ({ ...p, trackDist: 0 }));
const zeroGap = timeGapAtProgress(refZero, otherZero, 0.5, {
  basis: "time",
  durationSec,
});
assert(zeroGap != null && Math.abs(zeroGap + 20) > 1, `zero-trackDist gap not −elapsed, got ${zeroGap}`);

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

console.log("verify-time-gap ok", { gap, rawGap });
