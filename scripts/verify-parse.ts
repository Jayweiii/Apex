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

const fixtureLaps = parseTelemetryCsv(fixture);
assert(fixtureLaps.length === 2, `fixture expected 2 laps, got ${fixtureLaps.length}`);
const peak = Math.max(...fixtureLaps.flatMap((l) => l.points.map((p) => p.speed)));
assert(peak > 140, `Speed (MPH) should convert to km/h (peak ${peak})`);
assert(
  fixtureLaps.every((l) => l.points.some((p) => p.lat != null)),
  "fixture laps should keep GPS",
);

const sample = parseTelemetryCsv(
  fs.readFileSync(path.join(root, "public/sample-telemetry.csv"), "utf8"),
);
assert(sample.length === 3, `sample expected 3 laps, got ${sample.length}`);

const thunderhillPath = process.env.THUNDERHILL_CSV;
if (thunderhillPath && fs.existsSync(thunderhillPath)) {
  const laps = parseTelemetryCsv(fs.readFileSync(thunderhillPath, "utf8"));
  assert(laps.length === 6, `Thunderhill expected 6 laps, got ${laps.length}`);
  console.log(
    "thunderhill ok:",
    laps.map((l) => ({ lap: l.lapNumber, ms: l.lapTimeMs })),
  );
}

console.log(
  "verify-parse ok:",
  fixtureLaps.map((l) => ({
    lap: l.lapNumber,
    ms: l.lapTimeMs,
    maxKmh: Math.round(Math.max(...l.points.map((p) => p.speed))),
  })),
);
