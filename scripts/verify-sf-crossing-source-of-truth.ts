/**
 * SF crossing source-of-truth + interpolation contract.
 *
 * - Stored tracks.start_finish wins over catalog aliases (locked + heading).
 * - Gate crossings interpolate onto the SF line (not nearest-sample snap).
 * - Session 1aa2fb88 hot-lap boundaries stay within ~2 m of the drawn gate.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { haversineMeters } from "../src/lib/map-match";
import {
  distanceToStartFinishLineMeters,
  parseStartFinishLine,
  startFinishSplitRef,
} from "../src/lib/start-finish-line";
import {
  expandSourceGps,
  reparseLapsFromPoints,
} from "../src/lib/session-reparse";
import { resolveTrackStartFinish } from "../src/lib/track-start-finish";
import { splitLapsByStartFinish } from "../src/lib/split-laps";
import type { TelemetryPoint } from "../src/lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const THUNDERHILL_WEST_SF = {
  a: { lat: 39.53776, lon: -122.33888 },
  b: { lat: 39.53776, lon: -122.33862 },
  lat: 39.53776,
  lon: -122.33875,
  headingDeg: 175,
};

const storedLine = parseStartFinishLine(THUNDERHILL_WEST_SF);
assert(storedLine, "parse Thunderhill West SF");
const splitRef = startFinishSplitRef(storedLine);
assert(splitRef?.locked, "stored SF is locked");
assert(
  splitRef?.headingDeg != null && Math.abs(splitRef.headingDeg - 175) < 1,
  `heading from stored gate, got ${splitRef?.headingDeg}`,
);

const resolved = resolveTrackStartFinish(
  "custom-thunderhill-west",
  undefined,
  THUNDERHILL_WEST_SF,
);
assert(resolved?.locked, "resolve prefers stored + locked");
assert(
  Math.abs((resolved?.headingDeg ?? 0) - 175) < 1,
  "resolve keeps stored heading",
);

const catalogOnly = resolveTrackStartFinish("custom-thunderhill-west");
assert(catalogOnly, "catalog SF");
assert(!catalogOnly.locked, "catalog SF is not locked");

// Build repeated southbound hot-lap loops across the east-west gate at lat 39.53776.
const longTrace: TelemetryPoint[] = [];
let t = 0;
for (let lap = 0; lap < 6; lap += 1) {
  // Approach from north, cross SF, drive south loop, return north of SF for next.
  for (let i = 0; i <= 80; i += 1) {
    const frac = i / 80;
    // Southbound: 39.539 → 39.536 across the gate.
    const lat = 39.539 - frac * 0.003;
    longTrace.push({
      t,
      lat,
      lon: -122.33875,
      speed: 100,
    });
    t += 0.25;
  }
  // Pit/return north of the line without counting as a forward crossing:
  // go west then north then east (stays west of gate half-width? stay far).
  for (let i = 0; i <= 40; i += 1) {
    const frac = i / 40;
    longTrace.push({
      t,
      lat: 39.536 + frac * 0.0035,
      lon: -122.3395,
      speed: 60,
    });
    t += 0.25;
  }
}
const split = splitLapsByStartFinish(longTrace, {
  startFinish: splitRef,
  minLapMeters: 150,
  closeMeters: 60,
});
assert(split.length >= 3, `expected multiple laps, got ${split.length}`);

const hotBoundaries: Array<{ lap: number; which: string; dist: number }> = [];
for (const lap of split) {
  if (lap.lapNumber === 1) continue;
  if (lap.lapNumber === split.length) continue;
  const start = lap.points[0];
  const end = lap.points[lap.points.length - 1];
  for (const [which, pt] of [
    ["start", start],
    ["end", end],
  ] as const) {
    if (pt?.lat == null || pt.lon == null) continue;
    const dist = distanceToStartFinishLineMeters(storedLine, {
      lat: pt.lat,
      lon: pt.lon,
    });
    assert(dist != null, "distance defined");
    hotBoundaries.push({ lap: lap.lapNumber, which, dist });
    assert(
      dist <= 2.0,
      `lap ${lap.lapNumber} ${which} ${dist.toFixed(2)} m from SF line (want ≤2)`,
    );
  }
}

const dumpPath = resolve(
  import.meta.dirname,
  "../artifacts/sf-crossing/session-1aa2fb88-source-gps.json",
);
let sessionReport: Record<string, unknown> | null = null;
if (existsSync(dumpPath)) {
  const raw = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    source_gps?: unknown;
  };
  const points = expandSourceGps(raw.source_gps ?? raw);
  assert(points.length > 200, `expected dense GPS, got ${points.length}`);
  const reparsed = reparseLapsFromPoints(points, {
    startFinish: resolved,
    trackId: "custom-thunderhill-west",
  });
  const distances: Array<{
    lap: number;
    which: string;
    distM: number;
  }> = [];
  for (const lap of reparsed.laps) {
    const isOutStart = lap.lapNumber === 1;
    const isInEnd = lap.lapNumber === reparsed.laps.length;
    for (const which of ["start", "end"] as const) {
      const pt =
        which === "start"
          ? lap.points[0]
          : lap.points[lap.points.length - 1];
      if (pt?.lat == null || pt.lon == null) continue;
      const dist =
        distanceToStartFinishLineMeters(storedLine, {
          lat: pt.lat,
          lon: pt.lon,
        }) ??
        haversineMeters(storedLine!.lat, storedLine!.lon, pt.lat, pt.lon);
      distances.push({
        lap: lap.lapNumber,
        which,
        distM: Number(dist.toFixed(2)),
      });
      if (isOutStart && which === "start") continue;
      if (isInEnd && which === "end") continue;
      assert(
        dist <= 2.0,
        `session lap ${lap.lapNumber} ${which} ${dist.toFixed(2)} m from SF (want ≤2)`,
      );
    }
  }
  const hot = distances.filter(
    (d) =>
      !(d.lap === 1 && d.which === "start") &&
      !(d.lap === reparsed.laps.length && d.which === "end"),
  );
  sessionReport = {
    lapCount: reparsed.laps.length,
    laps: reparsed.laps.map((l) => ({
      lapNumber: l.lapNumber,
      lapTimeMs: l.lapTimeMs,
      startOffsetSec: l.startOffsetSec,
      points: l.points.length,
    })),
    boundaryDistancesM: distances,
    maxHotBoundaryM: Math.max(...hot.map((d) => d.distM), 0),
  };
}

console.log(
  JSON.stringify(
    {
      ok: true,
      storedHeadingDeg: splitRef?.headingDeg,
      syntheticLaps: split.length,
      syntheticMaxBoundaryM: Math.max(
        ...hotBoundaries.map((b) => b.dist),
        0,
      ),
      session: sessionReport,
    },
    null,
    2,
  ),
);
