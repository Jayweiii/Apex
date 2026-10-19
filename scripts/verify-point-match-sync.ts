/**
 * Point-matching sync: offset = videoTime − telemetrySessionTime,
 * guide steps, and synced badge gating for two-way playback.
 */
import {
  formatOffsetReadout,
  guessOffsetFromClipLength,
  isVideoSynced,
  offsetFromPointMatch,
  syncBadgeForVideo,
  syncGuideStepForVideo,
  SYNC_GUIDE_STEPS,
} from "../src/lib/video-sync-guide";
import { offsetForSessionMoment } from "../src/lib/sync-events";
import type { SessionVideo } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- offset math ---
assert(
  Math.abs(offsetFromPointMatch(42.5, 10.0) - 32.5) < 1e-9,
  "point-match offset",
);
assert(
  Math.abs(offsetForSessionMoment(42.5, 10.0) - 32.5) < 1e-9,
  "session moment alias",
);

// Session-level: same offset applies at each lap start via start_offset_sec.
const sessionOffset = offsetFromPointMatch(15, 120); // pin at lap2 start
assert(Math.abs(sessionOffset - (15 - 120)) < 1e-9, "session-level pin");

// --- badge / synced gate ---
const unsynced: SessionVideo = {
  id: "v1",
  provider: "youtube",
  youtubeId: "BI0ZwJiqYk8",
  offsetSec: 0,
  syncSource: "unsynced",
};
assert(!isVideoSynced(unsynced), "unsynced not locked");
assert(syncBadgeForVideo(unsynced).label === "Not synced", "badge not synced");

const synced: SessionVideo = {
  ...unsynced,
  offsetSec: 12.3,
  syncSource: "manual",
};
assert(isVideoSynced(synced), "manual is synced");
assert(syncBadgeForVideo(synced).label === "Synced", "badge synced");
assert(isVideoSynced({ ...unsynced, syncSource: "auto" }), "auto synced");
assert(
  isVideoSynced({ ...unsynced, syncSource: "time_of_day" }),
  "tod synced",
);

// --- guide steps ---
assert(SYNC_GUIDE_STEPS.length === 4, "four steps");
assert(
  SYNC_GUIDE_STEPS[0].label.includes("Pick lap"),
  "step1 copy",
);
assert(
  SYNC_GUIDE_STEPS[1].label.includes("speed chart"),
  "step2 copy",
);
assert(
  SYNC_GUIDE_STEPS[2].label.includes("Pause video"),
  "step3 copy",
);
assert(SYNC_GUIDE_STEPS[3].label === "Sync here", "step4 copy");

assert(syncGuideStepForVideo(null) === 1, "no clip → step 1");
assert(syncGuideStepForVideo(unsynced) === 2, "clip → step 2");
assert(
  syncGuideStepForVideo(unsynced, { telemetryPinned: true }) === 3,
  "pin → step 3",
);
assert(syncGuideStepForVideo(synced) === 4, "synced → step 4");
assert(
  syncGuideStepForVideo(unsynced, { justSaved: true }) === 4,
  "saved flash → step 4",
);

// --- auto-guess still works ---
const guessed = guessOffsetFromClipLength(150, 120_000, 0);
assert(guessed != null && Math.abs(guessed - 15) < 1e-9, `guess ${guessed}`);

assert(
  formatOffsetReadout(12, 0).includes("before"),
  "readout before",
);

console.log("verify-point-match-sync: ok");
