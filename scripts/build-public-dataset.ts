import fs from "node:fs";
import path from "node:path";
import { parseTelemetryCsv } from "../src/lib/parse-telemetry";

const root = path.resolve(__dirname, "..");
const source = path.join(root, "third_party", "STC_log.csv");
const out = path.join(root, "public", "datasets", "spreewaldring-stc.json");

const csv = fs.readFileSync(source, "utf8");
const laps = parseTelemetryCsv(csv).laps.filter((lap) => {
  const max = Math.max(...lap.points.map((point) => point.speed));
  return max >= 80 && lap.lapTimeMs >= 30_000 && lap.lapTimeMs <= 240_000;
});

const payload = {
  id: "pub-spreewaldring-stc",
  kind: "public",
  trackId: "spreewaldring",
  car: "Street / track day",
  name: "Spreewaldring — TrackAddict log",
  filename: "STC_log.csv",
  created_at: "2019-06-05T00:00:00.000Z",
  attribution: {
    source: "trackaddict-cli example dataset (STC_log.csv)",
    author: "Thomas Jungblut",
    url: "https://github.com/thomasjungblut/trackaddict-cli",
    license: "Apache-2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
    notes:
      "Original TrackAddict export bundled as an example in an Apache-2.0 project. Redistributed here with attribution under the same license. Out-laps and crawl segments were omitted for clarity.",
  },
  laps: laps.map((lap) => ({
    lapNumber: lap.lapNumber,
    lapTimeMs: lap.lapTimeMs,
    points: lap.points,
  })),
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(payload));
console.log(
  `Wrote ${out} (${laps.length} laps, ${fs.statSync(out).size} bytes)`,
);
