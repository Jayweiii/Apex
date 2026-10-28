/**
 * Re-parse single unsplit lap → many laps must:
 * - clear stale trim overrides when auto bounds change
 * - re-init trim slider bounds from new auto windows
 * - recompute session best = min(non-excluded lap times)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { theoreticalBestLap } from "../src/lib/analysis";
import {
  bestLapTimeMs,
  lapsEligibleForBest,
  MIN_FULL_LAP_MS,
} from "../src/lib/lap-quality";
import {
  autoBoundsForParsedLap,
  autoBoundsForStoredLap,
  buildReparsedLapRows,
  lapAutoBoundsChanged,
  preserveMatchedLapSideData,
  reparseLapsFromPoints,
  sessionDerivedFromLaps,
  type LapSideData,
} from "../src/lib/session-reparse";
import {
  autoLapBounds,
  buildTrimChartContext,
  resolveLapTrimBounds,
  type TrimableLap,
} from "../src/lib/lap-trim";
import type { ParsedLap, TelemetryPoint } from "../src/lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Chart context helper (mirrors SessionLapDetail trim slider init). */
function trimContextForLap(lap: TrimableLap, siblings: TrimableLap[]) {
  return buildTrimChartContext(lap, siblings);
}

const fixturePath = resolve(
  import.meta.dirname,
  "../src/lib/fixtures/gopro-thunderhill-west-session-gps.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  expectedHotLaps: number;
  points: Array<{ t: number; lat: number; lon: number; speed: number }>;
};

const points: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
}));

const split = reparseLapsFromPoints(points, {
  startFinish: { lat: 39.53905, lon: -122.3387 },
  trackId: "thunderhill-west",
});
assert(split.laps.length >= 8, `expected many laps, got ${split.laps.length}`);

// --- Simulate production bug: one giant unsplit lap with trim spanning all ---
const giantTelemetry = points.map((p) => ({ ...p }));
const giantDurationSec =
  giantTelemetry[giantTelemetry.length - 1]!.t - giantTelemetry[0]!.t;
const giantLap: TrimableLap = {
  id: "giant",
  lap_number: 1,
  lap_time_ms: Math.round(giantDurationSec * 1000),
  start_offset_sec: 0,
  telemetry: giantTelemetry,
  start_offset_override: 0,
  end_offset_override: giantDurationSec,
};
const giantBounds = autoLapBounds(giantLap);
assert(
  giantBounds.autoEnd - giantBounds.autoStart > 5 * 60,
  "fixture session is long enough to look unsplit",
);

const previousSide: LapSideData[] = [
  {
    lap_number: 1,
    excluded: false,
    exclude_reason: null,
    start_offset_override: giantLap.start_offset_override,
    end_offset_override: giantLap.end_offset_override,
    auto_start: giantBounds.autoStart,
    auto_end: giantBounds.autoEnd,
  },
];

const preserved = preserveMatchedLapSideData(previousSide, split.laps);
const lap1Side = preserved.get(1);
assert(lap1Side, "lap 1 side data present");
assert(
  lap1Side!.start_offset_override == null &&
    lap1Side!.end_offset_override == null,
  "stale trim cleared when bounds change (giant → short lap 1)",
);

// Unrelated lap numbers keep exclude when bounds match.
const hot = split.laps.find((l) => l.lapNumber === 3);
assert(hot, "lap 3 exists");
const hotBounds = autoBoundsForParsedLap(hot!);
const withExclude: LapSideData[] = [
  {
    lap_number: 3,
    excluded: true,
    exclude_reason: "inlap",
    start_offset_override: hotBounds.autoStart + 0.2,
    end_offset_override: null,
    auto_start: hotBounds.autoStart,
    auto_end: hotBounds.autoEnd,
  },
];
const keptExclude = preserveMatchedLapSideData(withExclude, split.laps).get(3);
assert(keptExclude?.excluded === true, "exclude preserved when bounds match");
assert(
  keptExclude?.start_offset_override === hotBounds.autoStart + 0.2,
  "trim kept when bounds unchanged",
);

const rows = buildReparsedLapRows(
  "7a23f279-c3c6-428d-82d6-1823cc8b3fd1",
  "1aa2fb88-8204-4abb-b745-520ea99819dd",
  split.laps,
  preserved,
);
assert(rows.length === split.laps.length, "row count matches");
assert(
  rows.every(
    (row) =>
      row.start_offset_override == null && row.end_offset_override == null,
  ),
  "all inserted rows have cleared trim after giant→multi reparse",
);

// --- Slider / chart bounds re-init from new auto windows ---
const trimables: TrimableLap[] = split.laps.map((lap, i) => ({
  id: `lap-${i + 1}`,
  lap_number: lap.lapNumber,
  lap_time_ms: lap.lapTimeMs,
  start_offset_sec: lap.startOffsetSec ?? null,
  telemetry: lap.points,
  start_offset_override: null,
  end_offset_override: null,
}));

for (const lap of trimables) {
  const bounds = resolveLapTrimBounds(lap);
  const auto = autoBoundsForStoredLap(lap);
  assert(
    Math.abs(bounds.autoStart - auto.autoStart) < 1e-6 &&
      Math.abs(bounds.autoEnd - auto.autoEnd) < 1e-6,
    `slider auto bounds match lap ${lap.lap_number}`,
  );
  assert(
    Math.abs(bounds.effectiveStart - bounds.autoStart) < 1e-6 &&
      Math.abs(bounds.effectiveEnd - bounds.autoEnd) < 1e-6,
    `effective trim = auto for lap ${lap.lap_number} (no stale override)`,
  );
  assert(
    bounds.autoEnd - bounds.autoStart < 5 * 60,
    `lap ${lap.lap_number} is not still the 20‑min blob`,
  );
  const chart = trimContextForLap(lap, trimables);
  assert(
    Math.abs(chart.trimStartT - (bounds.effectiveStart - chart.chartOriginSessionT)) <
      0.02,
    `chart start handle follows new bounds for lap ${lap.lap_number}`,
  );
  assert(
    Math.abs(chart.trimEndT - (bounds.effectiveEnd - chart.chartOriginSessionT)) <
      0.02,
    `chart end handle follows new bounds for lap ${lap.lap_number}`,
  );
}

// --- Session best = min of non-excluded ---
const derivedAll = sessionDerivedFromLaps(
  rows.map((row) => ({
    lap_time_ms: Number(row.lap_time_ms),
    excluded: Boolean(row.excluded),
  })),
);
// Session best ignores out/in/too-short laps (same rules as leaderboards).
const expectedBest = bestLapTimeMs(
  split.laps.map((l, i) => ({
    id: `lap-${i}`,
    lap_number: i + 1,
    lap_time_ms: l.lapTimeMs,
    points: l.points,
  })),
);
assert(
  expectedBest != null && expectedBest >= MIN_FULL_LAP_MS,
  "plausible flying-lap best",
);
assert(
  derivedAll.sessionBestMs === expectedBest,
  `session best ${derivedAll.sessionBestMs} === eligible best ${expectedBest}`,
);

const bestIdx = split.laps.findIndex((l) => l.lapTimeMs === expectedBest);
assert(bestIdx >= 0, "best index found");
const withBestExcluded = split.laps.map((lap, i) => ({
  id: `lap-${i}`,
  lap_number: i + 1,
  lap_time_ms: lap.lapTimeMs,
  excluded: i === bestIdx,
  points: lap.points,
}));
const derivedEx = sessionDerivedFromLaps(withBestExcluded);
const expectedExBest = bestLapTimeMs(withBestExcluded);
assert(
  expectedExBest != null && derivedEx.sessionBestMs === expectedExBest,
  `session best respects excludes (got ${derivedEx.sessionBestMs}, want ${expectedExBest})`,
);
assert(
  derivedEx.sessionBestMs !== expectedBest,
  "excluding the best changes session best",
);

// Theoretical best / sectors from eligible flying laps (excl. best + out/in).
const parsedForTheo: ParsedLap[] = lapsEligibleForBest(
  withBestExcluded.map((lap, i) => ({
    ...lap,
    lapNumber: split.laps[i]!.lapNumber,
    lapTimeMs: lap.lap_time_ms,
    points: lap.points,
    startOffsetSec: split.laps[i]!.startOffsetSec,
  })),
).map((lap) => ({
  lapNumber: lap.lapNumber!,
  lapTimeMs: lap.lap_time_ms,
  points: lap.points!,
  startOffsetSec: lap.startOffsetSec,
}));
const theo = theoreticalBestLap(parsedForTheo, 8);
assert(theo != null, "theoretical best computed");
assert(
  theo!.actualBestMs === expectedExBest,
  "theo actualBest matches eligible min",
);

// Bounds-changed helper
assert(
  lapAutoBoundsChanged(
    { autoStart: 0, autoEnd: 1200 },
    { autoStart: 0, autoEnd: 96 },
  ),
  "giant→short is a bounds change",
);
assert(
  !lapAutoBoundsChanged(
    { autoStart: 10, autoEnd: 110 },
    { autoStart: 10.1, autoEnd: 110.2 },
  ),
  "sub-0.5s jitter is not a bounds change",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      lapCount: split.laps.length,
      sessionBestMs: derivedAll.sessionBestMs,
      sessionBestSec: Number(((derivedAll.sessionBestMs ?? 0) / 1000).toFixed(3)),
      theoMs: theo?.theoreticalMs,
      sliderCheck: "all laps effective===auto",
    },
    null,
    2,
  ),
);
console.log("verify-reparse-reset-derived: ok");
