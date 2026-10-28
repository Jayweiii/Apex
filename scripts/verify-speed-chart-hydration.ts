/**
 * Every lap of session 1aa2fb88 (Thunderhill West Session 2) must render
 * nonempty speed data with real chart height after hydration from source_gps.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  hydrateLapsFromSourceGps,
  MIN_CHART_TELEMETRY_POINTS,
  speedChartRenderable,
} from "../src/lib/hydrate-lap-telemetry";
import { expandSourceGps } from "../src/lib/session-reparse";
import { resolveTrackStartFinish } from "../src/lib/track-start-finish";
import { STACKED_SPEED_MIN_HEIGHT } from "../src/lib/chart-height-contract";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const payloadPath = resolve(
  "artifacts/reparse-persist/gl010057-repair-payload.json",
);
assert(existsSync(payloadPath), "repair payload fixture missing");

const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
  source_gps: unknown;
};

/** Production session 1aa2fb88 boundaries (Thunderhill West Session 2). */
const SESSION_LAP_BOUNDS = [
  { lap_number: 1, lap_time_ms: 7059, start_offset_sec: 0 },
  { lap_number: 2, lap_time_ms: 108768, start_offset_sec: 7.059 },
  { lap_number: 3, lap_time_ms: 94732, start_offset_sec: 115.827 },
  { lap_number: 4, lap_time_ms: 99751, start_offset_sec: 210.559 },
  { lap_number: 5, lap_time_ms: 101009, start_offset_sec: 310.31 },
  { lap_number: 6, lap_time_ms: 94718, start_offset_sec: 411.319 },
  { lap_number: 7, lap_time_ms: 98998, start_offset_sec: 506.037 },
  { lap_number: 8, lap_time_ms: 94886, start_offset_sec: 605.035 },
  { lap_number: 9, lap_time_ms: 105453, start_offset_sec: 699.921 },
  { lap_number: 10, lap_time_ms: 110715, start_offset_sec: 805.374 },
  { lap_number: 11, lap_time_ms: 6133, start_offset_sec: 916.089 },
] as const;

// Simulate production slim telemetry (2 pts — empty speed graph).
const slimLaps = SESSION_LAP_BOUNDS.map((lap) => ({
  ...lap,
  telemetry: [
    {
      t: 0,
      lat: 39.53776,
      lon: -122.33875,
      speed: 80,
    },
    {
      t: lap.lap_time_ms / 1000,
      lat: 39.53776,
      lon: -122.33875,
      speed: 90,
    },
  ],
}));

for (const lap of slimLaps) {
  const before = speedChartRenderable(lap.telemetry);
  assert(!before.ok, `slim lap ${lap.lap_number} should fail chart contract`);
}

const hydrated = hydrateLapsFromSourceGps(slimLaps, payload.source_gps);
assert(hydrated, "hydration must run when source_gps is dense");

const report = hydrated.map((lap) => {
  const check = speedChartRenderable(lap.telemetry ?? []);
  assert(
    check.ok,
    `lap ${lap.lap_number}: ${check.reason} (pts=${check.pointCount})`,
  );
  assert(
    (lap.telemetry?.length ?? 0) >= MIN_CHART_TELEMETRY_POINTS,
    `lap ${lap.lap_number} still thin after hydrate`,
  );
  return {
    lapNumber: lap.lap_number,
    points: lap.telemetry?.length ?? 0,
    chartOk: check.ok,
  };
});

const sf = resolveTrackStartFinish("custom-thunderhill-west");
assert(sf, "custom-thunderhill-west resolves SF");
assert(
  Math.abs(sf.lat - 39.53776) < 0.001,
  `Thunderhill West SF should be on front straight (~39.53776), got ${sf.lat}`,
);
assert(
  Math.abs(sf.lon - -122.33875) < 0.001,
  `Thunderhill West SF lon ~-122.33875, got ${sf.lon}`,
);

assert(
  STACKED_SPEED_MIN_HEIGHT >= 160,
  `speed chart min height floor is ${STACKED_SPEED_MIN_HEIGHT}`,
);

const sourcePts = expandSourceGps(payload.source_gps).length;
assert(sourcePts >= 3_000, `source_gps dense enough to hydrate (${sourcePts})`);

console.log(
  JSON.stringify(
    {
      ok: true,
      sourcePts,
      startFinish: sf,
      speedChartMinHeightPx: STACKED_SPEED_MIN_HEIGHT,
      laps: report,
    },
    null,
    2,
  ),
);
