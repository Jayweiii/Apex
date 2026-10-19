/**
 * Exclude-from-best: eligibility, compare defaults, auto-flag heuristics.
 */
import { defaultLapIds, defaultLapPair } from "../src/lib/compare";
import {
  bestLapTimeMs,
  flagSuspiciousLaps,
  isLapExcluded,
  lapsEligibleForBest,
  lapsForDefaultCompare,
  type LapQualityInput,
} from "../src/lib/lap-quality";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(!isLapExcluded({}), "missing excluded → false");
assert(!isLapExcluded({ excluded: false }), "false");
assert(isLapExcluded({ excluded: true }), "true");

const laps = [
  { id: "a", lap_time_ms: 100_000, excluded: false },
  { id: "b", lap_time_ms: 90_000, excluded: true },
  { id: "c", lap_time_ms: 95_000, excluded: false },
];
assert(bestLapTimeMs(laps) === 95_000, "best ignores excluded");
assert(
  lapsEligibleForBest(laps).map((l) => l.id).join(",") === "a,c",
  "eligible filter",
);
assert(
  defaultLapPair(laps).ref === "c",
  `default ref should be fastest non-excluded, got ${defaultLapPair(laps).ref}`,
);
assert(
  defaultLapIds(laps, 2).join(",") === "c,a",
  `default ids ignore excluded, got ${defaultLapIds(laps, 2)}`,
);

const allExcluded = [
  { id: "x", lap_time_ms: 80_000, excluded: true },
  { id: "y", lap_time_ms: 81_000, excluded: true },
];
assert(bestLapTimeMs(allExcluded) === null, "no eligible → null best");
assert(
  lapsForDefaultCompare(allExcluded).length === 2,
  "compare fallback when all excluded",
);
assert(defaultLapPair(allExcluded).ref === "x", "fallback fastest excluded");

function ovalLap(
  seconds: number,
  opts?: { closeGapM?: number; jumpAt?: number },
): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  const n = 60;
  const closeGap = opts?.closeGapM ?? 5;
  for (let i = 0; i < n; i += 1) {
    const ang = (i / (n - 1)) * Math.PI * 2;
    // ~1 km oval
    let lat = 39.5 + Math.sin(ang) * 0.004;
    let lon = -122.3 + Math.cos(ang) * 0.005;
    if (i === n - 1 && closeGap > 10) {
      lat += closeGap / 111_320;
    }
    if (opts?.jumpAt === i) {
      lat += 0.002; // ~220 m
    }
    points.push({
      t: (seconds * i) / (n - 1),
      speed: 100,
      lat,
      lon,
    });
  }
  return points;
}

const qualityLaps: LapQualityInput[] = [
  {
    id: "good1",
    lap_number: 1,
    lap_time_ms: 100_000,
    telemetry: ovalLap(100),
  },
  {
    id: "good2",
    lap_number: 2,
    lap_time_ms: 101_000,
    telemetry: ovalLap(101),
  },
  {
    id: "short",
    lap_number: 3,
    lap_time_ms: 45_000, // duration outlier
    telemetry: ovalLap(45, { closeGapM: 200 }), // also partial
  },
  {
    id: "jump",
    lap_number: 4,
    lap_time_ms: 102_000,
    telemetry: ovalLap(102, { jumpAt: 20 }),
  },
];

const flags = flagSuspiciousLaps(qualityLaps);
const byId = new Map(flags.map((f) => [f.lapId, f]));
assert(byId.has("short"), "short lap flagged");
assert(
  byId.get("short")!.reasons.includes("duration_outlier"),
  "duration outlier",
);
assert(
  byId.get("short")!.reasons.includes("partial_coverage"),
  "partial coverage",
);
assert(byId.has("jump"), "gps jump flagged");
assert(byId.get("jump")!.reasons.includes("gps_jump"), "gps_jump reason");
assert(!byId.has("good1"), "clean lap not flagged");
assert(!byId.has("good2"), "clean lap 2 not flagged");

// Auto-flag never mutates excluded
assert(
  qualityLaps.every((lap) => !lap.excluded),
  "heuristics do not auto-exclude",
);

console.log("verify-exclude-laps ok");
