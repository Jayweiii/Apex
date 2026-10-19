/**
 * Point-match guide surface: badges, readout, stepper copy, Sync here CTA.
 */
import {
  formatOffsetReadout,
  guessOffsetFromClipLength,
  isVideoSynced,
  offsetFromPointMatch,
  SYNC_GUIDE_STEPS,
  syncBadgeForVideo,
  syncGuideStepForVideo,
} from "../src/lib/video-sync-guide";
import type { SessionVideo } from "../src/lib/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(!isVideoSynced(null), "null not synced");
assert(!isVideoSynced({ syncSource: "unsynced" }), "unsynced");
assert(
  !isVideoSynced({ syncSource: "lap_match" }),
  "lap_match is attach-only",
);
assert(isVideoSynced({ syncSource: "manual" }), "manual synced");
assert(isVideoSynced({ syncSource: "auto" }), "auto synced");

assert(syncBadgeForVideo({ syncSource: "manual" }).label === "Synced", "badge");
assert(
  syncBadgeForVideo({ syncSource: "unsynced" }).label === "Not synced",
  "badge unsynced",
);

assert(
  formatOffsetReadout(3.4, 0) === "Video starts 3.4s before the lap",
  formatOffsetReadout(3.4, 0),
);
assert(
  formatOffsetReadout(-2, 0) === "Video starts 2.0s after the lap",
  formatOffsetReadout(-2, 0),
);
assert(
  formatOffsetReadout(0, 0) === "Video starts at the lap start",
  "zero",
);
assert(
  formatOffsetReadout(1, 2.4) === "Video starts 3.4s before the lap",
  formatOffsetReadout(1, 2.4),
);

const guessed = guessOffsetFromClipLength(140, 120_000, 0);
assert(guessed != null && Math.abs(guessed - 10) < 1e-9, `guess ${guessed}`);
assert(guessOffsetFromClipLength(null, 120_000, 0) == null, "no duration");

assert(Math.abs(offsetFromPointMatch(42.5, 10) - 32.5) < 1e-9, "point match");

assert(SYNC_GUIDE_STEPS[0].label.includes("Pick lap"), "step1");
assert(SYNC_GUIDE_STEPS[1].label.includes("speed chart"), "step2");
assert(SYNC_GUIDE_STEPS[2].label.includes("Pause video"), "step3");
assert(SYNC_GUIDE_STEPS[3].label === "Sync here", "step4");

const bare: SessionVideo = {
  id: "1",
  provider: "youtube",
  youtubeId: "BI0ZwJiqYk8",
  offsetSec: 0,
  syncSource: "unsynced",
};
assert(syncGuideStepForVideo(null) === 1, "step paste");
assert(syncGuideStepForVideo(bare) === 2, "step pin chart");
assert(
  syncGuideStepForVideo(bare, { telemetryPinned: true }) === 3,
  "step pause video",
);
assert(
  syncGuideStepForVideo({ ...bare, syncSource: "manual", offsetSec: 4 }) === 4,
  "step synced",
);
assert(
  syncGuideStepForVideo(bare, { justSaved: true }) === 4,
  "step saved flash",
);

const guideSrc = readFileSync(
  resolve(import.meta.dirname, "../src/components/video/LapVideoSyncGuide.tsx"),
  "utf8",
);
assert(guideSrc.includes("Sync here"), "big sync button");
assert(!guideSrc.includes("Mark start line here"), "no mark-start");
assert(guideSrc.includes("How syncing works"), "help link");
assert(guideSrc.includes("Auto-guess"), "auto-guess");
assert(guideSrc.includes("Play map + video"), "two-way play");
assert(guideSrc.includes("This video starts at lap"), "session starts-at");
assert(
  guideSrc.includes("offsetFromPointMatch") || guideSrc.includes("offset = video"),
  "point math",
);

console.log("verify-video-sync-guide: ok");
