/**
 * Raw vs Snapped analysis mode: defaults, persistence helpers, and that
 * analysisPoints / compare / corners / theoretical best honor the mode.
 */
import { cornerBreakdown, theoreticalBestLap } from "../src/lib/analysis";
import {
  ANALYSIS_MODE_KEY,
  defaultAnalysisMode,
} from "../src/lib/analysis-mode";
import { compareLaps } from "../src/lib/compare";
import { builtinCenterline } from "../src/lib/centerlines";
import {
  analysisPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "../src/lib/map-match";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function oval(opts: {
  durationSec: number;
  hz: number;
  speedBias?: number;
  noiseM?: number;
}): TelemetryPoint[] {
  const { durationSec, hz, speedBias = 0, noiseM = 0 } = opts;
  const count = Math.round(durationSec * hz);
  const center = { lat: 39.540333, lon: -122.330694 };
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos(toRad(center.lat)) || 1;
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const progress = i / count;
    const a = progress * Math.PI * 2;
    const mod =
      1 + 0.18 * Math.sin(a * 3) * 0.55 + 0.18 * Math.cos(a * 2) * 0.35;
    const north =
      Math.sin(a) * 620 * mod + (noiseM ? Math.sin(i * 1.7) * noiseM : 0);
    const east =
      Math.cos(a) * 780 * mod + (noiseM ? Math.cos(i * 2.3) * noiseM : 0);
    points.push({
      t: i / hz,
      speed: 100 + 30 * Math.sin(a * 2) + speedBias,
      lat: center.lat + toDeg(north / 6371000),
      lon: center.lon + toDeg(east / (6371000 * cos)),
    });
  }
  return points;
}

assert(ANALYSIS_MODE_KEY === "apex.analysis-mode", "storage key");
assert(defaultAnalysisMode(true, null) === "snapped", "default snap on");
assert(defaultAnalysisMode(false, null) === "raw", "default snap off");
assert(defaultAnalysisMode(true, "raw") === "raw", "honor stored raw");
assert(defaultAnalysisMode(false, "snapped") === "snapped", "honor stored snap");

const line = builtinCenterline("thunderhill-east");
assert(line && line.length > 10, "builtin centerline");

const fastRaw = oval({ durationSec: 90, hz: 10, speedBias: 8, noiseM: 4 });
const slowRaw = oval({ durationSec: 96, hz: 10, speedBias: -4, noiseM: 6 });
const fastMatched = mapMatchLap(fastRaw, line);
const slowMatched = mapMatchLap(slowRaw, line);
assert(fastMatched && slowMatched, "map match");

const snappedFast = analysisPoints(fastMatched, fastRaw, "snapped");
const rawFast = analysisPoints(fastMatched, fastRaw, "raw");
assert(snappedFast !== rawFast, "mode switches point source");
assert(
  snappedFast.some((p) => p.trackDist != null),
  "snapped has trackDist",
);
assert(
  rawFast.every((p) => p.trackDist == null),
  "raw has no trackDist",
);
assert(
  analysisPoints(null, fastRaw, "snapped") === fastRaw,
  "no match falls back to raw",
);

const snappedSeries = compareLaps(
  analysisPoints(fastMatched, fastRaw, "snapped"),
  analysisPoints(slowMatched, slowRaw, "snapped"),
);
const rawSeries = compareLaps(
  analysisPoints(fastMatched, fastRaw, "raw"),
  analysisPoints(slowMatched, slowRaw, "raw"),
);
assert(snappedSeries.length > 20 && rawSeries.length > 20, "series length");
const mid = Math.floor(snappedSeries.length / 2);
assert(
  Math.abs(snappedSeries[mid]!.delta - rawSeries[mid]!.delta) > 1e-6 ||
    Math.abs(snappedSeries[mid]!.dist - rawSeries[mid]!.dist) > 1e-3,
  "raw vs snapped delta/dist differ",
);

function asLap(
  lapNumber: number,
  lapTimeMs: number,
  points: TelemetryPoint[],
  mode: GpsDisplayMode,
) {
  const matched = mapMatchLap(points, line);
  return {
    lapNumber,
    lapTimeMs,
    points: analysisPoints(matched, points, mode),
  };
}

const cornersSnapped = cornerBreakdown(
  asLap(1, 90_000, fastRaw, "snapped"),
  asLap(2, 96_000, slowRaw, "snapped"),
);
const cornersRaw = cornerBreakdown(
  asLap(1, 90_000, fastRaw, "raw"),
  asLap(2, 96_000, slowRaw, "raw"),
);
assert(cornersSnapped.length >= 1, "snapped corners");
assert(cornersRaw.length >= 1, "raw corners");

const theoSnapped = theoreticalBestLap([
  asLap(1, 90_000, fastRaw, "snapped"),
  asLap(2, 96_000, slowRaw, "snapped"),
]);
const theoRaw = theoreticalBestLap([
  asLap(1, 90_000, fastRaw, "raw"),
  asLap(2, 96_000, slowRaw, "raw"),
]);
assert(theoSnapped && theoRaw, "theo results");
assert(theoSnapped.sectorCount > 0 && theoRaw.sectorCount > 0, "theo sectors");
// Distance axes differ by mode; sector boundaries / best sources may shift
// even when total theoretical ms is close.

console.log("verify-analysis-mode: ok");
console.log(
  `  defaults snap=${defaultAnalysisMode(true)} raw=${defaultAnalysisMode(false)}`,
);
console.log(
  `  mid delta snapped=${snappedSeries[mid]!.delta.toFixed(3)}s raw=${rawSeries[mid]!.delta.toFixed(3)}s`,
);
console.log(
  `  corners snapped=${cornersSnapped.length} raw=${cornersRaw.length}`,
);
console.log(
  `  theo snapped=${(theoSnapped.theoreticalMs / 1000).toFixed(3)}s raw=${(theoRaw.theoreticalMs / 1000).toFixed(3)}s`,
);
