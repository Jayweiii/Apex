/**
 * Lap trim overrides: apply, nudge, video offset shift, merge/split.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyLapTrim,
  clearLapTrimOverrides,
  mergeAdjacentLaps,
  resolveLapTrimBounds,
  splitLapAtProgress,
  videoOffsetAfterStartShift,
  type TrimableLap,
} from "../src/lib/lap-trim";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function lap(
  id: string,
  n: number,
  start: number,
  durationSec: number,
): TrimableLap {
  const telemetry = [];
  for (let i = 0; i <= 10; i += 1) {
    telemetry.push({
      t: (durationSec * i) / 10,
      speed: 80 + i,
      lat: 39.5 + i * 0.0001,
      lon: -122.3,
    });
  }
  return {
    id,
    lap_number: n,
    lap_time_ms: Math.round(durationSec * 1000),
    start_offset_sec: start,
    telemetry,
  };
}

const base = lap("a", 1, 10, 100);
const bounds = resolveLapTrimBounds(base);
assert(bounds.autoStart === 10, "auto start");
assert(Math.abs(bounds.autoEnd - 110) < 1e-6, "auto end");
assert(!bounds.hasOverride, "no override");

const trimmed = applyLapTrim({
  ...base,
  start_offset_override: 12,
  end_offset_override: 100,
});
assert(trimmed.bounds.hasOverride, "has override");
assert(Math.abs(trimmed.start_offset_sec - 12) < 1e-6, "effective start");
assert(trimmed.lap_time_ms === 88_000, `lap time 88s, got ${trimmed.lap_time_ms}`);
assert(trimmed.telemetry[0].t === 0, "rebased t=0");
assert(
  Math.abs(trimmed.telemetry[trimmed.telemetry.length - 1].t - 88) < 0.05,
  "rebased end",
);

const cleared = clearLapTrimOverrides({
  ...base,
  start_offset_override: 12,
  end_offset_override: 100,
});
assert(cleared.start_offset_override == null, "cleared start");
assert(cleared.end_offset_override == null, "cleared end");

const offset = videoOffsetAfterStartShift(
  { offsetSec: 5, lapId: "a" },
  "a",
  2,
);
assert(offset === 7, "dedicated video shifts with start");
assert(
  videoOffsetAfterStartShift({ offsetSec: 5, lapId: null }, "a", 2) === 5,
  "session video unchanged",
);

const a = lap("a", 1, 0, 50);
const b = lap("b", 2, 50, 50);
const merged = mergeAdjacentLaps([a, b], "a");
assert(merged != null && merged.length === 1, "merge → 1 lap");
assert(merged![0].lap_time_ms === 100_000, "merged duration");

const split = splitLapAtProgress([a], "a", 0.5);
assert(split != null && split.length === 2, "split → 2");
assert(split![0].lap_number === 1 && split![1].lap_number === 2, "renumber");

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../supabase/migrations/20261019_lap_trim_overrides.sql",
  ),
  "utf8",
);
assert(
  migration.includes("start_offset_override"),
  "migration has start_offset_override",
);
assert(
  migration.includes("end_offset_override"),
  "migration has end_offset_override",
);
assert(migration.includes("laps_update_own"), "owner RLS");

const excludeUi = readFileSync(
  resolve(import.meta.dirname, "../src/components/LapList.tsx"),
  "utf8",
);
assert(
  !excludeUi.includes('type="checkbox"'),
  "exclude checkbox removed from LapList",
);
assert(
  excludeUi.includes("ExcludeFromBestControl"),
  "single exclude control in rows",
);

const detail = readFileSync(
  resolve(import.meta.dirname, "../src/components/SessionLapDetail.tsx"),
  "utf8",
);
assert(
  detail.includes("ExcludeFromBestControl"),
  "exclude in selected lap header",
);
assert(detail.includes("LapTrimControls"), "trim controls on session lap");

console.log("verify-lap-trim ok");
