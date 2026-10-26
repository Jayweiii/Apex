/**
 * Compare playback is TIME-synced (elapsed ms), not distance/% progress.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  compareManyByTime,
  sharedCompareDurationMs,
  valueAt,
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

function lap(opts: {
  durationSec: number;
  n?: number;
  /** Meters per second along track (constant). */
  speedMps: number;
}): TelemetryPoint[] {
  const n = opts.n ?? 40;
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / (n - 1)) * opts.durationSec;
    const dist = opts.speedMps * t;
    points.push({
      t,
      speed: opts.speedMps * 3.6,
      lat: 39.5 + dist * 1e-5,
      lon: -122.3 + dist * 1e-5,
      trackDist: dist,
    });
  }
  return points;
}

const fast = lap({ durationSec: 80, speedMps: 40 }); // 3200m
const slow = lap({ durationSec: 88, speedMps: 34 }); // slower → behind
const shared = sharedCompareDurationMs(80_000, 88_000);
assert(shared === 88_000, `max duration ${shared}`);

const series = compareManyByTime(fast, [slow], 41, shared);
assert(series.length === 41, "steps");
assert(series[0]!.t === 0, "starts at 0");
assert(Math.abs((series[40]!.t as number) - 88) < 1e-6, "ends at max");

// At identical elapsed t, delta = t_ref(d_other) − t (time gap, not meters).
const midT = series[20]!.t as number;
const fastDist = withDistance(fast);
const slowDist = withDistance(slow);
const otherDist = valueAtTime(slowDist, midT, "dist");
const expectedDelta = valueAt(fastDist, otherDist, "t") - midT;
assert(
  Math.abs((series[20]!.delta1 as number) - expectedDelta) < 1e-6,
  `delta = time gap at other's distance, got ${series[20]!.delta1} want ${expectedDelta}`,
);
assert(
  (series[20]!.delta1 as number) < -0.5,
  `slower car behind (neg gap), got ${series[20]!.delta1}`,
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
    lap_time_ms: 80_000,
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
    lap_time_ms: 88_000,
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
    deltaAtTime: "time gap at distance",
  }),
);
