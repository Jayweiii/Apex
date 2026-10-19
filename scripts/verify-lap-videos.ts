/**
 * Multi YouTube per session: pick order, bulk paste, coverage.
 */
import {
  parseBulkYouTubeUrls,
  pickSessionVideoForLap,
  videoCoverage,
} from "../src/lib/pick-session-video";
import type { SessionVideo } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const lapA = "lap-a";
const lapB = "lap-b";
const lapC = "lap-c";

const sessionLevel: SessionVideo = {
  id: "v-sess",
  provider: "youtube",
  youtubeId: "AAAAAAAAAAA",
  lapId: null,
  offsetSec: 12.5,
  syncSource: "manual",
};
const forA: SessionVideo = {
  id: "v-a",
  provider: "youtube",
  youtubeId: "BBBBBBBBBBB",
  lapId: lapA,
  lapIndex: 1,
  offsetSec: 3.1,
  syncSource: "manual",
};
const forB: SessionVideo = {
  id: "v-b",
  provider: "youtube",
  youtubeId: "CCCCCCCCCCC",
  lapId: lapB,
  lapIndex: 2,
  offsetSec: 0,
  syncSource: "unsynced",
};

assert(
  pickSessionVideoForLap([sessionLevel, forA, forB], lapA)?.id === "v-a",
  "lap A gets dedicated",
);
assert(
  pickSessionVideoForLap([sessionLevel, forA, forB], lapB)?.id === "v-b",
  "lap B gets dedicated",
);
assert(
  pickSessionVideoForLap([sessionLevel, forA, forB], lapC)?.id === "v-sess",
  "lap C falls back to session-level",
);
assert(
  pickSessionVideoForLap([forA, forB], lapC) === null,
  "no steal from other laps",
);
assert(
  pickSessionVideoForLap([sessionLevel, forA], lapB, { videoId: "v-a" })?.id ===
    "v-a",
  "explicit video id",
);

const coverage = videoCoverage([sessionLevel, forA], [lapA, lapB, lapC]);
assert(coverage.byLapId.get(lapA)?.id === "v-a", "coverage by lap");
assert(coverage.sessionLevel?.id === "v-sess", "session level");
assert(coverage.lapsWithVideo.has(lapB), "B covered by session-level");

const bulk = parseBulkYouTubeUrls(`
https://youtu.be/BI0ZwJiqYk8
https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12
dQw4w9WgXcQ
https://www.youtube.com/shorts/abcdefghijk
`);
assert(bulk[0] === "BI0ZwJiqYk8", `bulk0 ${bulk[0]}`);
assert(bulk[1] === "dQw4w9WgXcQ", `bulk1 ${bulk[1]}`);
assert(bulk.length === 3, `dedupe bulk len ${bulk.length}`);
assert(bulk[2] === "abcdefghijk", `bulk2 ${bulk[2]}`);

console.log(
  JSON.stringify({
    ok: true,
    pick: "lap > session > null",
    bulkIds: bulk.length,
    migration: "supabase/migrations/20261019_lap_videos.sql",
  }),
);
