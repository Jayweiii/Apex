/**
 * Exclude-from-best: eligibility, compare defaults, auto-flag heuristics.
 */
import { defaultLapIds, defaultLapPair } from "../src/lib/compare";
import {
  bestLapTimeMs,
  expectedTrackLengthMeters,
  flagSuspiciousLaps,
  isLapExcluded,
  isPlausibleFullLapMs,
  isShortOfTrackLength,
  lapsEligibleForBest,
  lapsForDefaultCompare,
  TRACK_LEN_FRAC,
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

// High-rate GPS jitter (short dt, small hop) must NOT look like a jump.
const jittery: TelemetryPoint[] = [];
for (let i = 0; i < 40; i += 1) {
  jittery.push({
    t: i * 0.05,
    speed: 40,
    lat: 39.54 + i * 0.00002 + (i % 3 === 0 ? 0.00003 : 0),
    lon: -122.34 + i * 0.00002,
  });
}
const jitterFlags = flagSuspiciousLaps([
  {
    id: "jitter",
    lap_number: 1,
    lap_time_ms: 95_000,
    telemetry: jittery,
  },
  {
    id: "peer",
    lap_number: 2,
    lap_time_ms: 96_000,
    telemetry: ovalLap(96),
  },
]);
assert(
  !jitterFlags.some((f) => f.lapId === "jitter" && f.reasons.includes("gps_jump")),
  "short-dt GPS jitter is not a GPS jump",
);

// ~100 m single blip (typical GoPro multipath) should not flag a flying lap.
const mildBlip = ovalLap(95);
mildBlip[20] = {
  ...mildBlip[20]!,
  lat: (mildBlip[20]!.lat ?? 0) + 0.0009, // ~100 m
};
const mildFlags = flagSuspiciousLaps([
  { id: "mild", lap_number: 1, lap_time_ms: 95_000, telemetry: mildBlip },
  { id: "peer2", lap_number: 2, lap_time_ms: 96_000, telemetry: ovalLap(96) },
]);
assert(
  !mildFlags.some((f) => f.lapId === "mild" && f.reasons.includes("gps_jump")),
  "≈100 m single blip is not a GPS jump",
);

// Auto-flag never mutates excluded
assert(
  qualityLaps.every((lap) => !lap.excluded),
  "heuristics do not auto-exclude",
);

// Out/in: first/last partial → label only (never auto-exclude)
const withOutIn: LapQualityInput[] = [
  {
    id: "out",
    lap_number: 1,
    lap_time_ms: 20_000,
    telemetry: ovalLap(20, { closeGapM: 200 }),
  },
  {
    id: "hot",
    lap_number: 2,
    lap_time_ms: 100_000,
    telemetry: ovalLap(100),
  },
  {
    id: "in",
    lap_number: 3,
    lap_time_ms: 25_000,
    telemetry: ovalLap(25, { closeGapM: 200 }),
  },
];
const outInFlags = flagSuspiciousLaps(withOutIn);
const outInById = new Map(outInFlags.map((f) => [f.lapId, f]));
assert(outInById.get("out")?.reasons.includes("out_lap"), "out lap label");
assert(outInById.get("out")?.labels.includes("Out lap"), "Out lap text");
assert(outInById.get("in")?.reasons.includes("in_lap"), "in lap label");
assert(outInById.get("in")?.labels.includes("In lap"), "In lap text");
assert(
  withOutIn.every((lap) => !lap.excluded),
  "out/in labels do not auto-exclude",
);

// Short-of-track-length: path << expected Thunderhill West centerline.
const westLen = expectedTrackLengthMeters("thunderhill-west");
assert(westLen != null && westLen > 2000, `west track length, got ${westLen}`);
assert(
  expectedTrackLengthMeters("custom-thunderhill-west") === westLen,
  "custom alias same length",
);

// Tiny oval (~1 km) vs West (~4 km) → short_distance.
const shortPts = ovalLap(82);
assert(
  isShortOfTrackLength(shortPts, "thunderhill-west"),
  "short path vs track length",
);
const shortFlags = flagSuspiciousLaps(
  [
    {
      id: "fullish",
      lap_number: 1,
      lap_time_ms: 95_000,
      telemetry: ovalLap(95),
    },
    {
      id: "shortSplit",
      lap_number: 2,
      lap_time_ms: 81_908,
      telemetry: shortPts,
    },
    {
      id: "full2",
      lap_number: 3,
      lap_time_ms: 96_000,
      telemetry: ovalLap(96),
    },
  ],
  "thunderhill-west",
);
assert(
  shortFlags.some(
    (f) => f.lapId === "shortSplit" && f.reasons.includes("short_distance"),
  ),
  "short_distance reason",
);
assert(
  !isPlausibleFullLapMs(81_908, 95_000),
  "1:21 vs 1:35 median fails duration gate (leaderboard)",
);
assert(TRACK_LEN_FRAC === 0.9, "90% track length threshold");

console.log("verify-exclude-laps ok");
