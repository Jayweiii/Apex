import fs from "node:fs";
import path from "node:path";
import { parseTelemetryCsv } from "../src/lib/parse-telemetry";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");

const fixture = fs.readFileSync(
  path.join(root, "src/lib/fixtures/trackaddict-snippet.csv"),
  "utf8",
);
assert(fixture.startsWith("# RaceRender"), "fixture should keep TrackAddict preamble");

const fixtureParsed = parseTelemetryCsv(fixture);
const fixtureLaps = fixtureParsed.laps;
assert(fixtureLaps.length === 2, `fixture expected 2 laps, got ${fixtureLaps.length}`);
const peak = Math.max(...fixtureLaps.flatMap((l) => l.points.map((p) => p.speed)));
assert(peak > 140, `Speed (MPH) should convert to km/h (peak ${peak})`);
assert(
  fixtureLaps.every((l) => l.points.some((p) => p.lat != null)),
  "fixture laps should keep GPS",
);
assert(
  fixtureLaps.every((l) =>
    l.points.some((p) => p.latG != null && p.lonG != null),
  ),
  "TrackAddict Accel X/Y should map to latG/lonG",
);

// Absolute UTC Time column must drive startedAtMs (not the elapsed Time column).
assert(
  fixtureParsed.startedAtMs != null,
  "fixture should expose startedAtMs from UTC Time",
);
assert(
  fixtureParsed.startedAtMs === 1789940468 * 1000,
  `startedAtMs expected 1789940468000, got ${fixtureParsed.startedAtMs}`,
);
assert(fixtureParsed.sessionDate, "fixture should expose sessionDate");
assert(
  fixtureLaps[0].startOffsetSec != null && fixtureLaps[0].startOffsetSec >= 0,
  "lap 1 should keep startOffsetSec",
);
assert(
  fixtureLaps[1].startOffsetSec != null &&
    fixtureLaps[1].startOffsetSec! > fixtureLaps[0].startOffsetSec!,
  "lap 2 startOffsetSec should be after lap 1",
);

const sample = parseTelemetryCsv(
  fs.readFileSync(
    path.join(root, "src/lib/fixtures/sample-telemetry.csv"),
    "utf8",
  ),
);
assert(sample.laps.length === 3, `sample expected 3 laps, got ${sample.laps.length}`);

const thunderhillPath = process.env.THUNDERHILL_CSV;
if (thunderhillPath && fs.existsSync(thunderhillPath)) {
  const laps = parseTelemetryCsv(fs.readFileSync(thunderhillPath, "utf8"));
  assert(laps.laps.length === 6, `Thunderhill expected 6 laps, got ${laps.laps.length}`);
  console.log(
    "thunderhill ok:",
    laps.laps.map((l) => ({ lap: l.lapNumber, ms: l.lapTimeMs })),
  );
}

console.log(
  "verify-parse ok:",
  fixtureLaps.map((l) => ({
    lap: l.lapNumber,
    ms: l.lapTimeMs,
    startOffsetSec: l.startOffsetSec,
    maxKmh: Math.round(Math.max(...l.points.map((p) => p.speed))),
  })),
  { startedAtMs: fixtureParsed.startedAtMs, sessionDate: fixtureParsed.sessionDate },
);
