/**
 * Shared playback time base: progress ↔ lap-local time ↔ GPS sample.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  indexNearestTime,
  lapDurationSec,
  plotFractionFromTime,
  progressFromTimeSec,
  progressNearPointTime,
  sampleAtTime,
  sampleAtTimeProgress,
  timeSecFromProgress,
} from "../src/lib/playback-timebase";
import type { GpsPoint } from "../src/lib/scrub";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const points: GpsPoint[] = [
  { t: 0, speed: 40, lat: 39.54, lon: -122.33, trackDist: 0 },
  { t: 10, speed: 120, lat: 39.541, lon: -122.331, trackDist: 200 },
  { t: 40, speed: 80, lat: 39.545, lon: -122.34, trackDist: 800 },
  { t: 80, speed: 50, lat: 39.55, lon: -122.35, trackDist: 1600 },
];

const durationSec = lapDurationSec(80_000);
assert(durationSec === 80, "duration from lap_time_ms");

assert(timeSecFromProgress(0, durationSec) === 0, "t at 0");
assert(timeSecFromProgress(1, durationSec) === 80, "t at 1");
assert(timeSecFromProgress(0.5, durationSec) === 40, "t at mid");

assert(progressFromTimeSec(40, durationSec) === 0.5, "progress at 40s");

// Mid-progress by TIME lands at t=40 (not trackDist mid at 800m / index mid).
const mid = sampleAtTimeProgress(points, 0.5, durationSec);
assert(Math.abs(mid.t - 40) < 1e-9, `time mid t=40, got ${mid.t}`);
assert(Math.abs(mid.lat - 39.545) < 1e-9, "time mid lat");
assert(Math.abs((mid.trackDist ?? 0) - 800) < 1e-6, "time mid trackDist");

// Interpolate between samples.
const at15 = sampleAtTime(points, 15);
assert(Math.abs(at15.t - 15) < 1e-9, "interp t");
// 10s@120 → 40s@80; mix=5/30 → ~113.3
assert(Math.abs(at15.speed - (120 - 40 * (5 / 30))) < 1e-6, "interp speed");

assert(indexNearestTime(points, 40) === 2, "nearest index at 40s");
assert(
  Math.abs(plotFractionFromTime(40, 0, 80) - 0.5) < 1e-9,
  "plot fraction mid",
);

const near = progressNearPointTime(
  points,
  39.545,
  -122.34,
  (aLat, aLon, bLat, bLon) =>
    Math.hypot(aLat - bLat, aLon - bLon),
  durationSec,
);
assert(Math.abs(near.progress - 0.5) < 1e-9, "click → time progress");

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const synced = read("src/components/video/SyncedLapView.tsx");
assert(synced.includes('progressBasis="time"'), "session map uses time basis");
assert(synced.includes("playback-timebase"), "session imports timebase");
assert(synced.includes("setPlaybackFraction"), "session drives DOM cursor");
assert(synced.includes("hoverController"), "session owns hover controller");
assert(
  synced.includes("clock.playing ? null : playbackIndex"),
  "no React chart index while playing",
);

const speed = read("src/components/SpeedChart.tsx");
assert(speed.includes("PlaybackCursorLine"), "speed DOM playback cursor");
assert(
  !speed.includes("Playback cursor — solid. Hover is a separate"),
  "old ReferenceLine playback comment removed or updated",
);
assert(speed.includes("PlaybackCursorLine"), "overlay present");
assert(
  !/\$\{?active\.t\}/.test(speed) || !speed.includes("<ReferenceLine\n                x={active.t}"),
  "no ReferenceLine on active.t",
);
assert(
  !speed.includes("x={active.t}"),
  "speed chart must not use ReferenceLine x={active.t}",
);

const hover = read("src/components/hover-cursor.ts");
assert(hover.includes("attachPlaybackLine"), "playback line attach");
assert(hover.includes("setPlaybackFraction"), "playback fraction API");
assert(hover.includes('transition = "none"'), "no transition on lines");

const clock = read("src/components/usePlaybackClock.ts");
assert(clock.includes("subscribe"), "clock subscribe for overlays");
// Playback must not push React state every frame (re-rendered the whole
// session view and starved taps on phones). Only the scrubber subscribes.
const tickBody = clock.slice(clock.indexOf("const tick"), clock.indexOf("requestAnimationFrame(tick);\n    return"));
assert(
  !/setProgressState\(next\);\s*\n\s*\}\s*\n\s*if \(next >= 1\)/.test(tickBody) &&
    /if \(next >= 1\) \{[\s\S]*setProgressState\(next\)/.test(tickBody),
  "clock tick only commits React progress at the end of the lap",
);
assert(clock.includes("useMemo("), "clock return object is memoized (stable callbacks)");
const bar = read("src/components/PlaybackControls.tsx");
assert(bar.includes("progressSubscribe"), "playback bar follows the clock itself");

console.log(
  JSON.stringify({
    ok: true,
    timeBase: "ms from interpolated lap start / lap_time_ms",
    mapSample: "sampleAtTimeProgress",
    chartCursor: "DOM PlaybackCursorLine via setPlaybackFraction",
    noRechartsRemount: true,
  }),
);
