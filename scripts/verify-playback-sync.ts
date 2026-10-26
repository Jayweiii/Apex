/**
 * Two-way YouTube ↔ track playback sync helpers + wiring checks.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createSyncSuppress,
  DRIFT_THRESHOLD_SEC,
  lapProgressFromVideoTime,
  nearestPlaybackSpeed,
  needsDriftCorrection,
} from "../src/lib/playback-sync";
import { lapAsSyncLap } from "../src/lib/dual-video-sync";
import { videoTimeFromLapProgress } from "../src/lib/video-sync";
import type { SessionVideo } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const lap = lapAsSyncLap({
  id: "a",
  lap_number: 1,
  lap_time_ms: 100_000,
  start_offset_sec: 10,
  telemetry: [
    { t: 0, speed: 40 },
    { t: 50, speed: 120 },
    { t: 100, speed: 40 },
  ],
});

const video: SessionVideo = {
  id: "v",
  provider: "youtube",
  youtubeId: "abc",
  offsetSec: 5,
  rate: 1,
  syncSource: "manual",
};

const midVideo = videoTimeFromLapProgress(lap, 0.5, video);
const back = lapProgressFromVideoTime(lap, midVideo, video);
assert(Math.abs(back - 0.5) < 1e-6, `round-trip progress, got ${back}`);

assert(!needsDriftCorrection(10, 10.1), "within threshold");
assert(
  needsDriftCorrection(10, 10 + DRIFT_THRESHOLD_SEC + 0.01),
  "over threshold",
);
assert(nearestPlaybackSpeed(0.9) === 1, "nearest 1x");
assert(nearestPlaybackSpeed(1.8) === 2, "nearest 2x");

const suppress = createSyncSuppress(50);
assert(!suppress.active(), "inactive before arm");
suppress.arm();
assert(suppress.active(), "active after arm");

const synced = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/SyncedLapView.tsx"),
  "utf8",
);
assert(synced.includes("onPlayerEvent"), "SyncedLapView listens to player events");
assert(synced.includes("createSyncSuppress"), "SyncedLapView guards loops");
assert(synced.includes("DRIFT_CHECK_INTERVAL_MS"), "SyncedLapView drift corrects");
assert(synced.includes("authorityRef"), "SyncedLapView authority");
assert(synced.includes("PlaybackControls"), "track playback without requiring video UI");

const dual = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/DualSessionVideos.tsx"),
  "utf8",
);
assert(dual.includes("onPlayerEvent"), "compare listens to player events");
assert(dual.includes("createSyncSuppress"), "compare guards loops");
assert(dual.includes("DRIFT_CHECK_INTERVAL_MS"), "compare drift corrects");
assert(dual.includes("authorityRef"), "compare authority");
assert(dual.includes("No onboard video"), "track-only compare playback");

const yt = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/YouTubePlayer.tsx"),
  "utf8",
);
assert(yt.includes("onPlayerEvent"), "YouTube emits events");
assert(yt.includes("onPlaybackRateChange"), "YT rate events");
assert(yt.includes("setPlaybackRate"), "YT rate control");

const compare = readFileSync(
  resolve(import.meta.dirname, "../src/components/LapCompare.tsx"),
  "utf8",
);
assert(compare.includes("stackedChannels"), "compare stacks channels");
assert(!compare.includes("setChartPanel"), "compare has no chart tabs");
assert(
  compare.includes("Telemetry ·") && compare.includes("time sync"),
  "compare stacked label (time sync default)",
);
assert(compare.includes('progressBasis="time"'), "compare map time basis");

console.log("verify-playback-sync ok");
