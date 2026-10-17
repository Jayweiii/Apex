/**
 * How lap delta is computed, and that snapped trackDist aligns on meters.
 *
 * Formula (compareLaps):
 *   For distance d along the reference axis from start/finish:
 *     delta(d) = t_other(d) − t_ref(d)   [seconds]
 *   X-axis = d in meters.
 *   When both laps have trackDist (map-matched), d is meters along the
 *   shared centerline (not % of each lap's own noisy path length).
 *   Otherwise d is cumulative raw GPS haversine (or speed×dt).
 */
import { cornerBreakdown, theoreticalBestLap } from "../src/lib/analysis";
import { compareLaps, valueAt, withDistance } from "../src/lib/compare";
import { builtinCenterline } from "../src/lib/centerlines";
import { mapMatchLap } from "../src/lib/map-match";
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
    const mod = 1 + 0.18 * Math.sin(a * 3) * 0.55 + 0.18 * Math.cos(a * 2) * 0.35;
    const north = Math.sin(a) * 620 * mod + (noiseM ? Math.sin(i * 1.7) * noiseM : 0);
    const east = Math.cos(a) * 780 * mod + (noiseM ? Math.cos(i * 2.3) * noiseM : 0);
    points.push({
      t: i / hz,
      speed: 100 + 30 * Math.sin(a * 2) + speedBias,
      lat: center.lat + toDeg(north / 6371000),
      lon: center.lon + toDeg(east / (6371000 * cos)),
    });
  }
  return points;
}

function main() {
  const line = builtinCenterline("thunderhill-east");
  assert(line, "builtin centerline");

  // Same physical lap, other is ~2s slower uniformly in time by stretching.
  const fastRaw = oval({ durationSec: 90, hz: 10 });
  const slowRaw = oval({ durationSec: 92, hz: 10, speedBias: -3, noiseM: 8 });

  const fast = mapMatchLap(fastRaw, line)!;
  const slow = mapMatchLap(slowRaw, line)!;
  assert(fast.every((p) => p.trackDist != null), "fast snapped");
  assert(slow.every((p) => p.trackDist != null), "slow snapped");

  const series = compareLaps(fast, slow, 100);
  assert(series.length === 100, "steps");
  assert(series.every((p) => p.snapped === true), "series marked snapped");

  // At mid-distance, both times come from the SAME absolute track meters.
  const mid = series[50];
  const fastSamples = withDistance(fast);
  const slowSamples = withDistance(slow);
  const expectedDelta =
    valueAt(slowSamples, mid.dist, "t") - valueAt(fastSamples, mid.dist, "t");
  assert(Math.abs(mid.delta - expectedDelta) < 1e-9, "delta = t_other(d) - t_ref(d)");

  // Absolute alignment: looking up other at ref's meters, not other%'s meters.
  // Build a deliberately longer noisy path so % alignment would disagree.
  const longerRaw = oval({ durationSec: 93, hz: 10, noiseM: 20, speedBias: -4 });
  const longer = mapMatchLap(longerRaw, line)!;
  const aligned = compareLaps(fast, longer, 60);
  const last = aligned[aligned.length - 1];
  const fastEnd = withDistance(fast).at(-1)!.dist;
  const longerEnd = withDistance(longer).at(-1)!.dist;
  // Shared axis is min of both snapped lengths — not independent percentages.
  assert(last.dist <= Math.min(fastEnd, longerEnd) + 1e-6, "axis uses shared meters");
  assert(last.snapped, "longer still snapped");

  // Raw fallback still produces a finite delta series.
  const rawSeries = compareLaps(fastRaw, slowRaw, 40);
  assert(rawSeries.length === 40, "raw fallback steps");
  assert(rawSeries.every((p) => p.snapped === false), "raw not snapped");
  assert(rawSeries.every((p) => Number.isFinite(p.delta)), "raw finite delta");

  const corners = cornerBreakdown(
    { lapNumber: 1, lapTimeMs: 90000, points: fast },
    { lapNumber: 2, lapTimeMs: 92000, points: slow },
  );
  assert(corners.length >= 1, "corners");
  assert(
    corners.some((c) => c.deltaMs != null),
    "corner deltas present",
  );

  const theo = theoreticalBestLap(
    [
      { lapNumber: 1, lapTimeMs: 90000, points: fast },
      { lapNumber: 2, lapTimeMs: 92000, points: slow },
    ],
    8,
  );
  assert(theo, "theo");
  assert(theo!.snapped === true, "theo uses snapped distances");
  assert(theo!.theoreticalMs <= theo!.actualBestMs, "theo ≤ actual");

  console.log(
    JSON.stringify({
      ok: true,
      formula: "delta(d) = t_other(d) - t_ref(d)",
      axis: "meters from SF (trackDist when snapped)",
      midDeltaSec: Number(mid.delta.toFixed(3)),
      snappedSteps: series.length,
      rawSteps: rawSeries.length,
      corners: corners.length,
      theoMs: theo!.theoreticalMs,
    }),
  );
}

main();
