/**
 * Multi-lap compare (up to 4): colors, URL slots, compareMany, shared progress.
 */
import {
  COMPARE_COLORS,
  compareHref,
  compareMany,
  defaultLapIds,
  MAX_COMPARE_LAPS,
  parseCompareSlots,
  serializeCompareSlots,
} from "../src/lib/compare";
import {
  advanceSharedProgress,
  dualVideoTimeAtProgress,
  lapAsSyncLap,
  sideHasPlayableVideo,
  type DualVideoSide,
} from "../src/lib/dual-video-sync";
import type { SessionVideo, TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function syntheticLap(scale: number): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < 40; i += 1) {
    const t = i * scale;
    points.push({
      t,
      speed: 80 + i,
      lat: 39.5 + i * 0.0001,
      lon: -122.3 + i * 0.0001,
      trackDist: i * 10,
    });
  }
  return points;
}

assert(COMPARE_COLORS.length >= MAX_COMPARE_LAPS, "4 distinct colors");
assert(MAX_COMPARE_LAPS === 4, "cap at 4");

const laps = [
  { id: "l1", lap_time_ms: 90_000 },
  { id: "l2", lap_time_ms: 91_000 },
  { id: "l3", lap_time_ms: 92_000 },
  { id: "l4", lap_time_ms: 93_000 },
  { id: "l5", lap_time_ms: 94_000 },
];
assert(defaultLapIds(laps, 4).join(",") === "l1,l2,l3,l4", "fastest four");

const parsed = parseCompareSlots({
  baseSessionId: "s1",
  ref: "l1",
  laps: "s1:l1,s2:l2,s1:l3,s3:l4,s9:l9",
});
assert(parsed.length === 4, `cap at 4 slots, got ${parsed.length}`);
assert(parsed[0].lapId === "l1" && parsed[0].sessionId === "s1", "ref first");
assert(parsed[3].lapId === "l4", "fourth slot");

const legacy = parseCompareSlots({
  baseSessionId: "s1",
  ref: "l1",
  other: "l2",
  otherSession: "s2",
});
assert(legacy.length === 2, "legacy pair");
assert(legacy[1].sessionId === "s2" && legacy[1].lapId === "l2", "legacy other");

const qs = serializeCompareSlots(
  [
    { sessionId: "s1", lapId: "l1" },
    { sessionId: "s1", lapId: "l2" },
    { sessionId: "s2", lapId: "l3" },
  ],
  "l1",
);
assert(qs.includes("laps="), "serialize laps");
assert(qs.includes("ref=l1"), "serialize ref");

const href = compareHref("s1", laps, "l1");
assert(href?.includes("laps="), "compareHref emits laps");
assert(href?.includes("other=l2"), `compareHref emits other, got ${href}`);

const refPts = syntheticLap(2.2);
const otherA = syntheticLap(2.3);
const otherB = syntheticLap(2.4);
const otherC = syntheticLap(2.5);
const series = compareMany(refPts, [otherA, otherB, otherC], 60);
assert(series.length === 60, "compareMany steps");
assert(typeof series[30].speed0 === "number", "speed0 ref");
assert(typeof series[30].speed3 === "number", "speed3 fourth");
assert(typeof series[30].delta1 === "number", "delta1");
assert(typeof series[30].delta3 === "number", "delta3");
assert(series[30].delta1 !== series[30].delta3, "distinct deltas");

const advanced = advanceSharedProgress(0, 10, 100_000, 90_000, 95_000, 110_000);
assert(
  Math.abs(advanced - 10 / 90) < 1e-6,
  `min of 4 laps clocks progress, got ${advanced}`,
);

const video: SessionVideo = {
  id: "v",
  provider: "youtube",
  youtubeId: "BI0ZwJiqYk8",
  offsetSec: 5,
  rate: 1,
  syncSource: "manual",
};
const side: DualVideoSide = {
  lap: lapAsSyncLap({
    id: "a",
    lap_number: 1,
    lap_time_ms: 90_000,
    start_offset_sec: 0,
    telemetry: refPts,
  }),
  video,
  label: "A",
};
assert(sideHasPlayableVideo(side), "youtube playable");
assert(dualVideoTimeAtProgress(side, 0) === 5, "offset at progress 0");

console.log("verify-multi-compare ok", {
  colors: COMPARE_COLORS.length,
  slots: parsed.length,
  series: series.length,
  midDelta: series[30].delta1,
  advanced,
});
