/**
 * Dual-session video lockstep helpers (shared elapsed-ms clock).
 */
import {
  advanceSharedProgress,
  dualProgressFromVideoTime,
  dualVideoTimeAtProgress,
  lapAsSyncLap,
  sharedCompareDurationMs,
  sideHasPlayableVideo,
  type DualVideoSide,
} from "../src/lib/dual-video-sync";
import type { SessionVideo } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const lapA = lapAsSyncLap({
  id: "a",
  lap_number: 1,
  lap_time_ms: 100_000,
  start_offset_sec: 0,
  telemetry: [
    { t: 0, speed: 40 },
    { t: 50, speed: 120 },
    { t: 100, speed: 40 },
  ],
});
const lapB = lapAsSyncLap({
  id: "b",
  lap_number: 2,
  lap_time_ms: 102_000,
  start_offset_sec: 5,
  telemetry: [
    { t: 0, speed: 42 },
    { t: 51, speed: 118 },
    { t: 102, speed: 41 },
  ],
});

const videoA: SessionVideo = {
  id: "va",
  provider: "youtube",
  youtubeId: "dQw4w9WgXcQ",
  offsetSec: 10,
  rate: 1,
  syncSource: "auto",
};
const videoB: SessionVideo = {
  id: "vb",
  provider: "youtube",
  youtubeId: "BI0ZwJiqYk8",
  offsetSec: 0,
  rate: 1,
  syncSource: "auto",
};

const sideA: DualVideoSide = {
  lap: lapA,
  video: videoA,
  label: "Ref",
};
const sideB: DualVideoSide = {
  lap: lapB,
  video: videoB,
  label: "Other",
};

assert(sideHasPlayableVideo(sideA), "youtube playable");
assert(sideHasPlayableVideo(sideB), "youtube B playable");
assert(
  !sideHasPlayableVideo({ ...sideB, video: { ...videoB, youtubeId: undefined } }),
  "youtube needs id",
);

const shared = sharedCompareDurationMs(lapA.lapTimeMs, lapB.lapTimeMs);
assert(shared === 102_000, `max clock, got ${shared}`);

const t0 = dualVideoTimeAtProgress(sideA, 0, shared);
assert(t0 === 10, `lap start video time = offset, got ${t0}`);

// progress 0.5 on max clock → elapsed 51s for BOTH sides
const tA = dualVideoTimeAtProgress(sideA, 0.5, shared)!;
const tB = dualVideoTimeAtProgress(sideB, 0.5, shared)!;
// A: offset 10 + start 0 + elapsed 51 → 61
assert(Math.abs(tA - 61) < 1e-6, `A at same elapsed 51s → 61, got ${tA}`);
// B: offset 0 + start 5 + elapsed 51 → 56
assert(Math.abs(tB - 56) < 1e-6, `B at same elapsed 51s → 56, got ${tB}`);

const back = dualProgressFromVideoTime(sideA, tA, shared);
assert(Math.abs(back - 0.5) < 1e-6, `round-trip progress, got ${back}`);

const advanced = advanceSharedProgress(0, 10, 100_000, 102_000);
assert(Math.abs(advanced - 10 / 102) < 1e-6, `10s of max 102s, got ${advanced}`);
assert(advanceSharedProgress(0.99, 5, 100_000, 50_000) === 1, "clamps at 1");
const advanced4 = advanceSharedProgress(0, 12, 100_000, 90_000, 95_000, 120_000);
assert(
  Math.abs(advanced4 - 0.1) < 1e-6,
  `4-lap max clock 120s: 12s → 0.1, got ${advanced4}`,
);

console.log("verify-dual-video ok", {
  t0,
  tA,
  tB,
  shared,
  advanced,
  advanced4,
});
