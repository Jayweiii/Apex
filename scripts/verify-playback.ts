/**
 * Shared playback clock: speed-aware progress, scrub helpers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  advancePlaybackProgress,
  clampPlaybackProgress,
  isPlaybackSpeed,
  nextPlaybackSpeed,
  PLAYBACK_SPEEDS,
  playbackProgressAtWallClock,
  scrubPlaybackProgress,
} from "../src/lib/playback";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(clampPlaybackProgress(-1) === 0, "clamp low");
assert(clampPlaybackProgress(2) === 1, "clamp high");
assert(PLAYBACK_SPEEDS.includes(0.25), "0.25x");
assert(PLAYBACK_SPEEDS.includes(2), "2x");
assert(isPlaybackSpeed(1), "1 is speed");
assert(!isPlaybackSpeed(1.5), "1.5 not preset");
assert(nextPlaybackSpeed(1) === 2, "next after 1x");
assert(nextPlaybackSpeed(2) === 0.25, "wrap");

const half = advancePlaybackProgress(0, 50, 100_000, 1);
assert(Math.abs(half - 0.5) < 1e-9, `1x 50s of 100s → 0.5, got ${half}`);

const double = advancePlaybackProgress(0, 25, 100_000, 2);
assert(Math.abs(double - 0.5) < 1e-9, `2x 25s of 100s → 0.5, got ${double}`);

const quarter = advancePlaybackProgress(0, 100, 100_000, 0.25);
assert(
  Math.abs(quarter - 0.25) < 1e-9,
  `0.25x 100s of 100s → 0.25, got ${quarter}`,
);

// Absolute wall clock (RAF must use this — never accumulate dt).
const abs = playbackProgressAtWallClock({
  originProgress: 0.1,
  originMs: 1_000,
  nowMs: 1_000 + 2_500,
  durationMs: 100_000,
  speed: 1,
});
assert(Math.abs(abs - 0.125) < 1e-9, `abs 2.5s @1x from 0.1 → 0.125, got ${abs}`);

const abs2x = playbackProgressAtWallClock({
  originProgress: 0,
  originMs: 0,
  nowMs: 1_000,
  durationMs: 100_000,
  speed: 2,
});
assert(Math.abs(abs2x - 0.02) < 1e-9, `abs 1s @2x → 0.02, got ${abs2x}`);

assert(scrubPlaybackProgress(0.5, -1) < 0.5, "scrub left");
assert(scrubPlaybackProgress(0.5, 1) > 0.5, "scrub right");

const dual = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/DualSessionVideos.tsx"),
  "utf8",
);
assert(dual.includes("PlaybackControls"), "compare uses PlaybackControls");
assert(
  dual.includes("playbackProgressAtWallClock"),
  "compare uses absolute wall clock",
);
assert(dual.includes("performance.now"), "wall-clock RAF origin");
assert(
  dual.includes("authorityRef.current === \"clock\" && playingRef.current"),
  "clock keeps authority while playing",
);
assert(
  dual.includes("if (!playing)") && dual.includes("progressRef.current = progress"),
  "do not rewind progressRef from throttled prop while playing",
);
assert(dual.includes("ArrowLeft"), "keyboard scrub");

const clockHook = readFileSync(
  resolve(import.meta.dirname, "../src/components/usePlaybackClock.ts"),
  "utf8",
);
assert(
  clockHook.includes("playbackProgressAtWallClock"),
  "session clock uses absolute wall time",
);
assert(
  !clockHook.includes("advancePlaybackProgress"),
  "session clock does not accumulate dt",
);

const synced = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/SyncedLapView.tsx"),
  "utf8",
);
assert(synced.includes("PlaybackControls"), "session lap uses PlaybackControls");
assert(synced.includes("usePlaybackClock"), "session lap owns clock");
assert(synced.includes("LapVideoSyncGuide"), "point-match guide");
assert(synced.includes("isVideoSynced"), "gates two-way on synced");
assert(
  synced.includes('authorityRef.current === "clock" && playingRef.current'),
  "session clock keeps authority while playing",
);
assert(
  synced.includes("actual < t - 0.15") ||
    synced.includes("lapStartVideo"),
  "Play seeks video to lap-synced time when behind",
);

const controls = readFileSync(
  resolve(import.meta.dirname, "../src/components/PlaybackControls.tsx"),
  "utf8",
);
assert(controls.includes("PLAYBACK_SPEEDS"), "uses PLAYBACK_SPEEDS");
assert(controls.includes("type=\"range\""), "scrub bar");
assert(
  controls.includes("min-w-[") || controls.includes("width: 96"),
  "fixed play/pause width",
);

console.log("verify-playback ok");
