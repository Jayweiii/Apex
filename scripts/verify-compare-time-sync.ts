/**
 * Compare playback is TIME-synced (elapsed ms), not distance/% progress.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareManyByTime,
  sharedCompareDurationMs,
  valueAtTime,
  withDistance,
} from "../src/lib/compare";
import {
  dualVideoTimeAtProgress,
  lapAsSyncLap,
} from "../src/lib/dual-video-sync";
import type { SessionVideo, TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function lap(scale: number, n = 40): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    points.push({
      t: i * scale,
      speed: 80 + i,
      lat: 39.5 + i * 0.0001,
      lon: -122.3 + i * 0.0001,
      trackDist: i * 10 * scale,
    });
  }
  return points;
}

const fast = lap(2.0); // 78s
const slow = lap(2.2); // 85.8s
const shared = sharedCompareDurationMs(78_000, 85_800);
assert(shared === 85_800, `max duration ${shared}`);

const series = compareManyByTime(fast, [slow], 41, shared);
assert(series.length === 41, "steps");
assert(series[0]!.t === 0, "starts at 0");
assert(Math.abs((series[40]!.t as number) - 85.8) < 1e-6, "ends at max");

// At identical elapsed t, speeds come from each lap's own sample — not same dist.
const midT = series[20]!.t as number;
const fastDist = withDistance(fast);
const slowDist = withDistance(slow);
const expectedDelta =
  valueAtTime(slowDist, midT, "dist") - valueAtTime(fastDist, midT, "dist");
assert(
  Math.abs((series[20]!.delta1 as number) - expectedDelta) < 1e-6,
  "delta = dist gap at same t",
);

const video: SessionVideo = {
  id: "v",
  provider: "youtube",
  youtubeId: "abc",
  offsetSec: 3,
  rate: 1,
  syncSource: "manual",
};
const sideFast = {
  lap: lapAsSyncLap({
    id: "f",
    lap_number: 1,
    lap_time_ms: 78_000,
    start_offset_sec: 0,
    telemetry: fast,
  }),
  video,
  label: "fast",
};
const sideSlow = {
  lap: lapAsSyncLap({
    id: "s",
    lap_number: 2,
    lap_time_ms: 85_800,
    start_offset_sec: 0,
    telemetry: slow,
  }),
  video: { ...video, offsetSec: 0 },
  label: "slow",
};
const p = 0.25;
const elapsed = (p * shared) / 1000;
const vf = dualVideoTimeAtProgress(sideFast, p, shared)!;
const vs = dualVideoTimeAtProgress(sideSlow, p, shared)!;
assert(Math.abs(vf - (3 + elapsed)) < 1e-6, `fast video at elapsed ${elapsed}`);
assert(Math.abs(vs - elapsed) < 1e-6, `slow video at same elapsed`);

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const compare = read("src/components/LapCompare.tsx");
assert(compare.includes('progressBasis="time"'), "compare map uses time basis");
assert(compare.includes("compareManyByTime"), "compare charts default time");
assert(compare.includes('useState<CompareAxis>("time")'), "time axis default");
assert(compare.includes("HoverCursorScope"), "shared rAF cursor scope");
assert(compare.includes("PlaybackCursorLine"), "DOM playback cursor");
assert(compare.includes("setPlaybackFraction"), "rAF fraction drive");

const dual = read("src/components/video/DualSessionVideos.tsx");
assert(dual.includes("sharedCompareDurationMs"), "dual uses max clock");
assert(dual.includes("dualProgressFromVideoTime"), "absolute elapsed inverse");
assert(dual.includes("UI_PROGRESS_INTERVAL_MS"), "throttled React progress");
assert(dual.includes("onProgressSubscribe"), "exposes rAF subscribe");

const css = read("src/app/globals.css");
assert(css.includes("touch-action: manipulation"), "touch-action on clickables");
assert(css.includes("@custom-variant hover"), "hover only on fine pointer");
assert(css.includes(":active"), "pressed/active styles");
assert(css.includes(":focus-visible"), "focus-visible styles");

console.log(
  JSON.stringify({
    ok: true,
    clock: "max lap_time_ms",
    chartDefault: "time",
    mapBasis: "time",
    deltaAtTime: "meters gap",
  }),
);
