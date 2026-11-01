/**
 * Video coverage: which laps a (one-lap / several-lap / session) video holds,
 * and offsets for clips that start at a given lap.
 */
import {
  coveredLapNumbers,
  describeLapNumbers,
  lapCoverage,
  offsetForVideoStartingAtLap,
} from "../src/lib/video-coverage";
import { sessionVideoFromYouTube } from "../src/lib/youtube-match";
import { videoTimeFromLapProgress } from "../src/lib/video-sync";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Session from the bug report: out-lap 8s, then ~95–110s laps.
const laps = [
  { lapNumber: 1, startOffsetSec: 0, lapTimeMs: 8016 },
  { lapNumber: 2, startOffsetSec: 8.016, lapTimeMs: 107803 },
  { lapNumber: 3, startOffsetSec: 115.819, lapTimeMs: 94731 },
  { lapNumber: 4, startOffsetSec: 210.55, lapTimeMs: 99739 },
  { lapNumber: 5, startOffsetSec: 310.289, lapTimeMs: 101007 },
];
const syncLap = (n: number) => {
  const l = laps[n - 1];
  return { id: `l${n}`, lapNumber: n, lapTimeMs: l.lapTimeMs, startOffsetSec: l.startOffsetSec, points: [] };
};

// A ~2-minute clip pinned at session start covers laps 1–2 only.
const sessionVideo = { offsetSec: 0, rate: 1 };
assert(lapCoverage(laps[1], sessionVideo, 116) === "full", "lap 2 inside 116s clip");
assert(lapCoverage(laps[4], sessionVideo, 116) === "none", "lap 5 outside clip");
assert(lapCoverage(laps[2], sessionVideo, 116) === "none", "lap 3 starts at clip end");
assert(lapCoverage(laps[2], sessionVideo, 160) === "partial", "lap 3 partly in 160s clip");
assert(lapCoverage(laps[4], sessionVideo, null) === "unknown", "unknown before duration");
assert(
  describeLapNumbers(coveredLapNumbers(laps, sessionVideo, 116)) === "laps 1–2",
  "describes covered laps",
);
assert(describeLapNumbers([4]) === "lap 4", "single lap label");
assert(describeLapNumbers([2, 4]) === "laps 2, 4", "non-contiguous label");

// One-lap clip of lap 5: t=0 must be lap 5's start (offset on session clock).
const lap5Clip = { offsetSec: offsetForVideoStartingAtLap(laps[4]), rate: 1 };
const t0 = videoTimeFromLapProgress(syncLap(5), 0, lap5Clip);
const t1 = videoTimeFromLapProgress(syncLap(5), 1, lap5Clip);
assert(Math.abs(t0) < 1e-6, `lap 5 clip starts at 0 (got ${t0})`);
assert(Math.abs(t1 - 101.007) < 1e-3, `lap 5 clip ends at lap time (got ${t1})`);
assert(lapCoverage(laps[4], lap5Clip, 102) === "full", "lap 5 covered by its clip");
assert(lapCoverage(laps[3], lap5Clip, 102) === "none", "lap 4 not in lap-5 clip");

// sessionVideoFromYouTube must subtract the lap start (was: offset ignored it,
// pointing lap 5 ~5 minutes into a one-lap clip → play/stop loop).
const attached = sessionVideoFromYouTube({
  youtubeId: "abcdefghijk",
  lapId: "l5",
  lapIndex: 5,
  lapStartOffsetSec: laps[4].startOffsetSec,
  offsetSec: 0,
});
assert(
  Math.abs(videoTimeFromLapProgress(syncLap(5), 0, attached)) < 1e-6,
  `attached lap clip starts at its lap (offset ${attached.offsetSec})`,
);
const padded = sessionVideoFromYouTube({
  youtubeId: "abcdefghijk",
  lapId: "l5",
  lapStartOffsetSec: laps[4].startOffsetSec,
  durationSec: 111,
  lapMs: 101007,
});
const padStart = videoTimeFromLapProgress(syncLap(5), 0, padded);
assert(Math.abs(padStart - (111 - 101.007) / 2) < 1e-3, `padding centred (got ${padStart})`);

console.log(JSON.stringify({ ok: true, coverage: "lap-aware", offsets: "session clock" }));
