/**
 * Session-page ?lap=N helpers and legacy redirect paths.
 */
import {
  legacyLapRedirectHref,
  resolveSelectedLap,
  sessionLapHref,
} from "../src/lib/session-lap-url";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const laps = [
  { id: "a", lap_number: 1, lap_time_ms: 95_000 },
  { id: "b", lap_number: 2, lap_time_ms: 92_500 },
  { id: "c", lap_number: 3, lap_time_ms: 93_100 },
];

assert(sessionLapHref("sess", 2) === "/sessions/sess?lap=2", "href number");
assert(
  sessionLapHref("sess", laps[1], { videoId: "vid" }) ===
    "/sessions/sess?lap=2&v=vid",
  "href with video",
);
assert(
  legacyLapRedirectHref("sess", "uuid-b", { v: "vid", t: "12" }) ===
    "/sessions/sess?lap=uuid-b&v=vid&t=12",
  "legacy redirect",
);

assert(resolveSelectedLap(laps, null)?.id === "b", "default fastest");
assert(resolveSelectedLap(laps, "3")?.id === "c", "by number");
assert(resolveSelectedLap(laps, "a")?.id === "a", "by uuid");
assert(resolveSelectedLap(laps, "99") === null, "missing number");
assert(resolveSelectedLap([], "1") === null, "empty");

const withExcluded = [
  { id: "a", lap_number: 1, lap_time_ms: 95_000 },
  { id: "b", lap_number: 2, lap_time_ms: 90_000, excluded: true },
  { id: "c", lap_number: 3, lap_time_ms: 93_100 },
];
assert(
  resolveSelectedLap(withExcluded, null)?.id === "c",
  "default ignores excluded",
);

console.log("session-lap-url: ok");
