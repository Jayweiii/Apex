/**
 * Dual-session video lockstep helpers (lap-relative shared progress).
 */
import {
  advanceSharedProgress,
  dualVideoTimeAtProgress,
  lapAsSyncLap,
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

const t0 = dualVideoTimeAtProgress(sideA, 0);
assert(t0 === 10, `lap start video time = offset, got ${t0}`);
const tMid = dualVideoTimeAtProgress(sideA, 0.5);
assert(tMid != null && tMid > 10, "mid progress advances video");

const advanced = advanceSharedProgress(0, 10, 100_000, 102_000);
assert(Math.abs(advanced - 0.1) < 1e-6, `10s of 100s lap → 0.1, got ${advanced}`);
assert(advanceSharedProgress(0.99, 5, 100_000, 50_000) === 1, "clamps at 1");
const advanced4 = advanceSharedProgress(0, 9, 100_000, 90_000, 95_000, 120_000);
assert(
  Math.abs(advanced4 - 0.1) < 1e-6,
  `4-lap min clock 90s: 9s → 0.1, got ${advanced4}`,
);

console.log("verify-dual-video ok", {
  t0,
  tMid,
  advanced,
  advanced4,
});
