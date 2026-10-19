/**
 * Chase / heading-up map helpers + prefs.
 */
import {
  clampChaseZoom,
  DEFAULT_MAP_VIEW_PREFS,
  MAP_VIEW_PREFS_KEY,
  readMapViewPrefs,
  writeMapViewPrefs,
} from "../src/lib/map-view-prefs";
import {
  bearingAtProgress,
  bearingDeg,
  centroidLatLon,
  shortestAngleDelta,
  smoothBearingAtProgress,
} from "../src/lib/track-bearing";
import type { GpsPoint } from "../src/lib/scrub";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// North-ish leg
assert(Math.abs(bearingDeg(0, 0, 1, 0) - 0) < 1, "north bearing ~0");
// East-ish
assert(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 1, "east bearing ~90");

assert(shortestAngleDelta(350, 10) === 20, "wrap +");
assert(shortestAngleDelta(10, 350) === -20, "wrap -");

const oval: GpsPoint[] = [];
for (let i = 0; i < 40; i += 1) {
  const a = (i / 40) * Math.PI * 2;
  oval.push({
    t: i,
    speed: 100,
    lat: 39.5 + 0.01 * Math.cos(a),
    lon: -122.3 + 0.015 * Math.sin(a),
    trackDist: i * 20,
  });
}

const b0 = bearingAtProgress(oval, 0);
const bMid = bearingAtProgress(oval, 0.5);
assert(Number.isFinite(b0) && Number.isFinite(bMid), "bearings finite");
assert(Math.abs(shortestAngleDelta(b0, bMid)) > 20, "bearing changes around oval");

let smoothed: number | null = null;
for (let p = 0; p <= 1; p += 0.05) {
  smoothed = smoothBearingAtProgress(oval, p, smoothed, { alpha: 0.3 });
}
assert(smoothed != null && Number.isFinite(smoothed), "smoothed bearing");

const c = centroidLatLon([
  { lat: 1, lon: 2 },
  { lat: 3, lon: 4 },
]);
assert(c != null && c.lat === 2 && c.lon === 3, "centroid");

assert(clampChaseZoom(15) === 16, "zoom floor");
assert(clampChaseZoom(20) === 19, "zoom ceil");
assert(clampChaseZoom(17.5) === 17.5, "zoom mid");

assert(DEFAULT_MAP_VIEW_PREFS.mode === "overview", "default overview");
assert(MAP_VIEW_PREFS_KEY === "apex.map-view", "prefs key");

// Node has no localStorage — read returns defaults.
const prefs = readMapViewPrefs();
assert(prefs.mode === "overview", "read default mode");
writeMapViewPrefs({ mode: "chase", followId: "lap-1", chaseZoom: 18.5 });
// still defaults in node unless we polyfill — just ensure no throw

console.log("verify-chase-map ok", {
  b0: Math.round(b0),
  bMid: Math.round(bMid),
  smoothed: Math.round(smoothed!),
  zoom: clampChaseZoom(18),
});
