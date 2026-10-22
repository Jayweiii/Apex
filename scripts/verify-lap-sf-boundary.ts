/**
 * Lap SF boundary snap + out/in map metadata (Jason session 1aa2fb88).
 */
import { readFileSync } from "node:fs";
import {
  alignLapBoundariesToSf,
  distanceToSfCenterMeters,
  distanceToSfLineMeters,
  lapKindMapLabel,
  lapKindsForSession,
  projectOntoSfLine,
  resolveLapSfCrossing,
  snapParsedLapsToSfGate,
} from "../src/lib/lap-sf-boundary";
import { splitLapsByStartFinish } from "../src/lib/split-laps";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SF = {
  lat: 39.53776,
  lon: -122.33875,
  a: { lat: 39.53776, lon: -122.33888 },
  b: { lat: 39.53776, lon: -122.33862 },
  headingDeg: 175,
};

const L10_LAST = { lat: 39.53777, lon: -122.33888 };
const L11_FIRST = { lat: 39.537771, lon: -122.338876 };

const beforeLine = distanceToSfLineMeters(L11_FIRST, SF);
const beforeCenter = distanceToSfCenterMeters(L11_FIRST, SF);
assert(
  beforeLine != null && beforeLine > 0.5 && beforeLine < 5,
  `before line ~1.2m, got ${beforeLine}`,
);
assert(
  beforeCenter != null && beforeCenter > 8 && beforeCenter < 15,
  `before center ~11m, got ${beforeCenter}`,
);

const projected = projectOntoSfLine(L11_FIRST, SF)!;
const afterLine = distanceToSfLineMeters(projected, SF)!;
assert(afterLine < 0.05, `after snap on line, got ${afterLine}`);

const laps = alignLapBoundariesToSf(
  [
    {
      lap_number: 10,
      telemetry: [
        { t: 0, lat: 39.53, lon: -122.34, speed: 100 },
        { t: 110, lat: L10_LAST.lat, lon: L10_LAST.lon, speed: 57 },
      ],
    },
    {
      lap_number: 11,
      telemetry: [
        { t: 0, lat: L11_FIRST.lat, lon: L11_FIRST.lon, speed: 56 },
        { t: 6, lat: 39.540297, lon: -122.340181, speed: 26 },
      ],
    },
  ],
  SF,
);

const aLast = laps[0]!.telemetry![laps[0]!.telemetry!.length - 1]!;
const bFirst = laps[1]!.telemetry![0]!;
assert(
  Math.abs(aLast.lat! - bFirst.lat!) < 1e-9 &&
    Math.abs(aLast.lon! - bFirst.lon!) < 1e-9,
  "lap10 end meets lap11 start",
);
assert(
  distanceToSfLineMeters({ lat: bFirst.lat!, lon: bFirst.lon! }, SF)! < 0.05,
  "aligned start on SF line",
);

const kinds = lapKindsForSession([
  {
    id: "out",
    lap_number: 1,
    lap_time_ms: 8_000,
    telemetry: [
      { t: 0, lat: 39.54, lon: -122.34, speed: 40 },
      { t: 8, lat: SF.lat, lon: SF.lon, speed: 80 },
    ],
  },
  {
    id: "hot",
    lap_number: 2,
    lap_time_ms: 100_000,
    telemetry: Array.from({ length: 40 }, (_, i) => {
      const ang = (i / 39) * Math.PI * 2;
      return {
        t: (100 * i) / 39,
        lat: SF.lat + Math.sin(ang) * 0.004,
        lon: SF.lon + Math.cos(ang) * 0.005,
        speed: 100,
      } satisfies TelemetryPoint;
    }),
  },
  {
    id: "in",
    lap_number: 3,
    lap_time_ms: 6_133,
    telemetry: [
      { t: 0, lat: L11_FIRST.lat, lon: L11_FIRST.lon, speed: 56 },
      { t: 6.133, lat: 39.540297, lon: -122.340181, speed: 26 },
    ],
  },
]);
assert(kinds.get(1) === "out", "lap1 out");
assert(kinds.get(3) === "in", "lap3 in");
assert(lapKindMapLabel("out") === "OUT", "OUT label");
assert(lapKindMapLabel("in") === "IN", "IN label");

const crossing = resolveLapSfCrossing(
  [
    { t: 0, lat: L11_FIRST.lat, lon: L11_FIRST.lon, speed: 56 },
    { t: 6, lat: 39.540297, lon: -122.340181, speed: 26 },
  ],
  "in",
  SF,
)!;
assert(
  distanceToSfLineMeters(crossing, SF)! < 0.05,
  "crossing projected onto SF",
);

function ovalSession(): TelemetryPoint[] {
  const pts: TelemetryPoint[] = [];
  for (let i = 0; i < 30; i += 1) {
    pts.push({
      t: i * 0.2,
      lat: SF.lat + 0.003 - (i / 29) * 0.003,
      lon: SF.lon,
      speed: 60,
    });
  }
  for (let lap = 0; lap < 2; lap += 1) {
    for (let i = 0; i < 80; i += 1) {
      const ang = (i / 80) * Math.PI * 2;
      pts.push({
        t: 6 + lap * 80 + i,
        lat: SF.lat + Math.sin(ang) * 0.004,
        lon: SF.lon + (1 - Math.cos(ang)) * 0.005,
        speed: 110,
      });
    }
  }
  for (let i = 0; i < 20; i += 1) {
    pts.push({
      t: 166 + i * 0.3,
      lat: SF.lat + (i / 19) * 0.003,
      lon: SF.lon - (i / 19) * 0.001,
      speed: 40,
    });
  }
  return pts;
}

const split = splitLapsByStartFinish(ovalSession(), {
  startFinish: SF,
  minLapMeters: 300,
});
assert(split.length >= 2, `split produced laps (${split.length})`);
const snapped = snapParsedLapsToSfGate(split, SF);
assert(snapped.length === split.length, "snap preserves count");

const leaflet = readFileSync("src/components/LeafletTrackMap.tsx", "utf8");
const chase = readFileSync("src/components/ChaseTrackMap.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
assert(leaflet.includes("sfCrossingIcon"), "leaflet SF marker");
assert(leaflet.includes("lapKindIcon"), "leaflet out/in");
assert(chase.includes("sfCrossingHtml"), "chase SF marker");
assert(chase.includes("lapKindHtml"), "chase out/in");
assert(css.includes("apex-sf-crossing__dot"), "SF crossing CSS");
assert(css.includes("apex-lap-kind__badge--in"), "in-lap CSS");

console.log(
  JSON.stringify(
    {
      ok: true,
      before_line_m: Number(beforeLine!.toFixed(3)),
      before_center_m: Number(beforeCenter!.toFixed(3)),
      after_line_m: Number(afterLine.toFixed(3)),
      lap10_meets_lap11: true,
    },
    null,
    2,
  ),
);
