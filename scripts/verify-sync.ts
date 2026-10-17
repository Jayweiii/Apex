import {
  cursorFromVideoTime,
  sessionTimeFromVideo,
  suggestOffsetFromClocks,
  videoTimeFromSession,
} from "../src/lib/video-sync";
import {
  fitOffsetRate,
  predictNextCrossing,
  solveLapSequence,
} from "../src/lib/lap-estimator";
import {
  parseLapTimeFromTitle,
  parseTitleHints,
  parseYouTubeId,
} from "../src/lib/youtube";
import { suggestVideosForSession } from "../src/lib/youtube-match";
import { YOUTUBE_CATALOG } from "../src/lib/youtube-catalog";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- youtube id / title ---
assert(parseYouTubeId("BI0ZwJiqYk8") === "BI0ZwJiqYk8", "bare id");
assert(
  parseYouTubeId("https://youtu.be/BI0ZwJiqYk8") === "BI0ZwJiqYk8",
  "youtu.be",
);
assert(
  parseYouTubeId("https://www.youtube.com/watch?v=BI0ZwJiqYk8&t=12") ===
    "BI0ZwJiqYk8",
  "watch url",
);
assert(
  parseYouTubeId("https://www.youtube.com/shorts/BI0ZwJiqYk8") === "BI0ZwJiqYk8",
  "shorts",
);

const lapTitle = parseLapTimeFromTitle("Thunderhill East ND Miata 2:17.1");
assert(lapTitle?.lapMs === 137100, `lap ms ${lapTitle?.lapMs}`);
assert(lapTitle?.precisionMs === 100, `precision ${lapTitle?.precisionMs}`);

const hints = parseTitleHints("Buttonwillow Circuit ND Miata 2:10.3");
assert(hints.trackId === "buttonwillow-13cw", `track ${hints.trackId}`);
assert(hints.lapMs === 130300, `lap ${hints.lapMs}`);

// --- sync math ---
const video = { offsetSec: 12.4, rate: 1 };
assert(
  Math.abs(videoTimeFromSession(10, video) - 22.4) < 1e-9,
  "videoTimeFromSession",
);
assert(
  Math.abs(sessionTimeFromVideo(22.4, video) - 10) < 1e-9,
  "sessionTimeFromVideo",
);
assert(
  Math.abs(suggestOffsetFromClocks(5, 1_000_000, 990_000) - (-5)) < 1e-9,
  "clock offset",
);

const cursor = cursorFromVideoTime(22.4, video, [
  {
    id: "a",
    lapNumber: 1,
    lapTimeMs: 120000,
    startOffsetSec: 0,
    points: [
      { t: 0, speed: 50 },
      { t: 10, speed: 100 },
      { t: 20, speed: 80 },
    ],
  },
]);
assert(cursor.lap?.id === "a", "cursor lap");
assert(Math.abs(cursor.lapTime - 10) < 1e-6, `cursor lapTime ${cursor.lapTime}`);
assert(cursor.point != null && Math.abs(cursor.point.speed - 100) < 1e-6, "interp speed");

// --- matcher ---
const suggestions = suggestVideosForSession(
  {
    trackId: "thunderhill-east",
    sessionDate: "2026-09-01",
    laps: [
      { id: "lap-a", lap_time_ms: 137100 },
      { id: "lap-b", lap_time_ms: 140000 },
    ],
  },
  YOUTUBE_CATALOG,
);
const hit = suggestions.find((s) => s.entry.youtubeId === "BI0ZwJiqYk8");
assert(hit, "should suggest BI0ZwJiqYk8 for 2:17.1 Thunderhill session");
assert(hit!.lapId === "lap-a", "should pick matching lap id");

// --- estimator ---
const logged = [
  { startOffsetSec: 0, lapTimeMs: 100000 },
  { startOffsetSec: 100, lapTimeMs: 110000 },
  { startOffsetSec: 210, lapTimeMs: 105000 },
];
const crossings = [5, 105, 215]; // offset 5, rate 1
const solved = solveLapSequence(crossings, logged);
assert(solved, "solver should find alignment");
assert(Math.abs(solved!.offsetSec - 5) < 0.05, `offset ${solved!.offsetSec}`);
assert(Math.abs(solved!.rate - 1) < 0.01, `rate ${solved!.rate}`);
assert(solved!.rmsErrorSec < 0.25, `rms ${solved!.rmsErrorSec}`);

const fit = fitOffsetRate([5, 105], [0, 100]);
assert(fit && Math.abs(fit.offsetSec - 5) < 1e-9, "fit offset");

const predicted = predictNextCrossing([5, 105], logged);
assert(predicted != null && Math.abs(predicted - 215) < 0.5, `predict ${predicted}`);

console.log("verify-sync ok");
