/**
 * POV / chase map: bearing calculation + prefs.
 */
import {
  DEFAULT_BASEMAP,
  readBasemapPrefs,
  writeBasemapPrefs,
} from "../src/lib/basemap-prefs";
import {
  clampChaseZoom,
  DEFAULT_MAP_VIEW_PREFS,
  MAP_VIEW_PREFS_KEY,
  POV_DEFAULT_ZOOM,
  POV_PITCH_DEG,
  readMapViewPrefs,
  writeMapViewPrefs,
} from "../src/lib/map-view-prefs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

// --- Bearing from consecutive points (GPS course fallback) ---
assert(Math.abs(bearingDeg(0, 0, 1, 0) - 0) < 1, "north bearing ~0");
assert(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 1, "east bearing ~90");
assert(Math.abs(bearingDeg(0, 0, -1, 0) - 180) < 1, "south bearing ~180");
assert(Math.abs(bearingDeg(0, 0, 0, -1) - 270) < 1, "west bearing ~270");

assert(shortestAngleDelta(350, 10) === 20, "wrap +");
assert(shortestAngleDelta(10, 350) === -20, "wrap -");
assert(Math.abs(shortestAngleDelta(0, 180)) === 180, "180 delta");

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

// Duplicate-point look-ahead should still yield a finite heading.
const stuck: GpsPoint[] = [
  { t: 0, speed: 80, lat: 39.5, lon: -122.3, trackDist: 0 },
  { t: 1, speed: 80, lat: 39.5, lon: -122.3, trackDist: 0 },
  { t: 2, speed: 80, lat: 39.5001, lon: -122.3, trackDist: 10 },
];
assert(Number.isFinite(bearingAtProgress(stuck, 0.1)), "stuck-point bearing");

let smoothed: number | null = null;
const rawDeltas: number[] = [];
let prevRaw: number | null = null;
for (let p = 0; p <= 1; p += 0.05) {
  const raw = bearingAtProgress(oval, p);
  if (prevRaw != null) rawDeltas.push(Math.abs(shortestAngleDelta(prevRaw, raw)));
  prevRaw = raw;
  const next = smoothBearingAtProgress(oval, p, smoothed, { alpha: 0.3 });
  if (smoothed != null) {
    const jump = Math.abs(shortestAngleDelta(smoothed, next));
    assert(jump < 45, `smoothed jump too large at p=${p}: ${jump}`);
  }
  smoothed = next;
}
assert(smoothed != null && Number.isFinite(smoothed), "smoothed bearing");
assert(rawDeltas.some((d) => d > 5), "raw bearing moves on oval");

const c = centroidLatLon([
  { lat: 1, lon: 2 },
  { lat: 3, lon: 4 },
]);
assert(c != null && c.lat === 2 && c.lon === 3, "centroid");

assert(clampChaseZoom(15) === 16, "zoom floor");
assert(clampChaseZoom(20) === 19, "zoom ceil");
assert(clampChaseZoom(17.5) === 17.5, "zoom mid");

assert(POV_PITCH_DEG === 60, "POV pitch ~60°");
assert(POV_DEFAULT_ZOOM >= 17 && POV_DEFAULT_ZOOM <= 18, "POV zoom 17–18");
assert(
  DEFAULT_MAP_VIEW_PREFS.chaseZoom >= 17 &&
    DEFAULT_MAP_VIEW_PREFS.chaseZoom <= 18,
  "default chase zoom in POV band",
);

assert(DEFAULT_MAP_VIEW_PREFS.mode === "overview", "default overview");
assert(MAP_VIEW_PREFS_KEY === "apex.map-view", "prefs key");

const prefs = readMapViewPrefs();
assert(prefs.mode === "overview", "read default mode");
writeMapViewPrefs({ mode: "chase", followId: "lap-1", chaseZoom: 18 });

assert(DEFAULT_BASEMAP === "satellite", "default basemap satellite");
assert(
  readBasemapPrefs() === "satellite" || readBasemapPrefs() === "street",
  "basemap readable",
);
// Node has no window — prefs helpers no-op safely (same as map-view-prefs).
writeBasemapPrefs("street");
writeBasemapPrefs("satellite");

const chaseSrc = readFileSync(
  resolve(import.meta.dirname, "../src/components/ChaseTrackMap.tsx"),
  "utf8",
);
assert(chaseSrc.includes("applyBasemapTiles"), "chase basemap swap helper");
assert(
  !/\.setStyle\s*\(/.test(chaseSrc),
  "no map.setStyle on chase basemap swap",
);
assert(chaseSrc.includes("jumpTo"), "chase reasserts camera after swap");
assert(
  chaseSrc.includes("basemap-satellite") && chaseSrc.includes("basemap-street"),
  "dual basemap sources for snappy opacity swap",
);
assert(
  chaseSrc.includes("raster-opacity"),
  "basemap swap uses raster-opacity (no removeSource)",
);
const applyHelper = chaseSrc.slice(
  chaseSrc.indexOf("function applyBasemapTiles"),
  chaseSrc.indexOf("function syncCameraAttrs"),
);
assert(applyHelper.includes("raster-opacity"), "applyBasemapTiles toggles opacity");
assert(
  !/\.removeSource\s*\(/.test(applyHelper) && !/\.setStyle\s*\(/.test(applyHelper),
  "applyBasemapTiles avoids setStyle/removeSource",
);
assert(chaseSrc.includes("maxPitch"), "chase maxPitch above POV pitch");
assert(chaseSrc.includes("data-apex-pitch") || chaseSrc.includes("apexPitch"), "exposes pitch for QA");

console.log("verify-chase-map ok", {
  b0: Math.round(b0),
  bMid: Math.round(bMid),
  smoothed: Math.round(smoothed!),
  pitch: POV_PITCH_DEG,
  zoom: clampChaseZoom(POV_DEFAULT_ZOOM),
  basemap: readBasemapPrefs(),
});
