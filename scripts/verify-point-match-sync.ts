/**
 * Guided start-line sync helpers + leftover point-match offset math.
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
import { offsetForLapStart } from "../src/lib/video-sync";
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
assert(
  Math.abs(offsetForLapStart(12.4, 2) - 10.4) < 1e-9,
  "mark start line offset",
);

const sessionOffset = offsetFromPointMatch(15, 120);
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
assert(
  !isVideoSynced({ ...unsynced, syncSource: "lap_match" }),
  "lap_match attach-only",
);

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

// --- guide steps (Mark start line flow) ---
assert(SYNC_GUIDE_STEPS.length === 4, "four steps");
assert(SYNC_GUIDE_STEPS[0].label.includes("Paste"), "step1 copy");
assert(SYNC_GUIDE_STEPS[1].label.includes("Mark start"), "step2 copy");
assert(SYNC_GUIDE_STEPS[2].label.includes("Check"), "step3 copy");
assert(SYNC_GUIDE_STEPS[3].label === "Saved", "step4 copy");

assert(syncGuideStepForVideo(null) === 1, "no clip → step 1");
assert(syncGuideStepForVideo(unsynced) === 2, "clip → step 2 mark");
assert(syncGuideStepForVideo(synced) === 3, "synced → step 3 check");
assert(
  syncGuideStepForVideo(unsynced, { justSaved: true }) === 4,
  "saved flash → step 4",
);

const guessed = guessOffsetFromClipLength(150, 120_000, 0);
assert(guessed != null && Math.abs(guessed - 15) < 1e-9, `guess ${guessed}`);

assert(
  formatOffsetReadout(12, 0).includes("before"),
  "readout before",
);

console.log("verify-point-match-sync: ok");
