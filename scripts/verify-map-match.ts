import { builtinCenterline } from "../src/lib/centerlines";
import { compareLaps, withDistance } from "../src/lib/compare";
import { cornerBreakdown } from "../src/lib/analysis";
import {
  buildCenterlineFromLaps,
  haversineMeters,
  mapMatchLap,
  parseCenterline,
  savitzkyGolay,
  snapToCenterline,
  type LatLon,
} from "../src/lib/map-match";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Synthetic oval at ~10 Hz (TrackAddict-like). */
function ovalLap(opts?: {
  hz?: number;
  noiseM?: number;
  durationSec?: number;
  speedBias?: number;
}): TelemetryPoint[] {
  const hz = opts?.hz ?? 10;
  const noiseM = opts?.noiseM ?? 0;
  const durationSec = opts?.durationSec ?? 90;
  const speedBias = opts?.speedBias ?? 0;
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
    const north = Math.sin(a) * 620 * mod;
    const east = Math.cos(a) * 780 * mod;
    const noiseN = noiseM ? (Math.sin(i * 1.7) * noiseM) / 2 : 0;
    const noiseE = noiseM ? (Math.cos(i * 2.3) * noiseM) / 2 : 0;
    points.push({
      t: (i / hz),
      speed: 100 + 35 * Math.sin(a * 2) + speedBias,
      lat: center.lat + toDeg((north + noiseN) / 6371000),
      lon: center.lon + toDeg((east + noiseE) / (6371000 * cos)),
    });
  }
  return points;
}

function main() {
  // Savitzky–Golay preserves a constant series and reduces spike energy.
  const smooth = savitzkyGolay([1, 2, 100, 2, 1, 2, 1], 5);
  assert(smooth[2] < 60, "SG should damp spike");
  assert(Math.abs(savitzkyGolay([5, 5, 5, 5, 5], 5)[2] - 5) < 1e-9, "SG constant");

  const clean = ovalLap({ hz: 10, noiseM: 0 });
  const noisy = ovalLap({ hz: 18, noiseM: 12, speedBias: 1 }); // GoPro-like 18 Hz
  const noisySlow = ovalLap({ hz: 10, noiseM: 14, durationSec: 92, speedBias: -2 });

  const built = buildCenterlineFromLaps([clean, noisy, noisySlow]);
  assert(built && built.length >= 50, "centerline from laps");

  const thunderhill = builtinCenterline("thunderhill-east");
  assert(thunderhill && thunderhill.length >= 50, "builtin thunderhill");

  const matched = mapMatchLap(noisy, thunderhill);
  assert(matched && matched.length === noisy.length, "matched length");
  assert(
    matched!.every((point) => point.trackDist != null && point.rawLat != null),
    "trackDist + raw GPS preserved",
  );

  // Monotonic along-track progress (allow tiny float noise).
  for (let i = 1; i < matched!.length; i += 1) {
    assert(
      matched![i].trackDist + 1e-6 >= matched![i - 1].trackDist,
      `monotonic trackDist at ${i}`,
    );
  }

  // Snapped points should sit closer to the centerline than raw GPS.
  function meanLateral(points: TelemetryPoint[], line: LatLon[]) {
    const snapped = snapToCenterline(points, line);
    const sum = snapped.reduce((acc, point) => acc + Math.abs(point.lateralOffset), 0);
    return sum / snapped.length;
  }
  const rawLateral = meanLateral(noisy, thunderhill!);
  const snappedLateral = meanLateral(matched!, thunderhill!);
  assert(snappedLateral < rawLateral * 0.35, "snap reduces lateral error");
  assert(snappedLateral < 3, `snapped mean lateral ${snappedLateral}`);

  // Distance alignment for compare should use trackDist.
  const dists = withDistance(matched!);
  assert(dists[dists.length - 1].dist > 1000, "track length meters");
  assert(
    Math.abs(dists[10].dist - (matched![10].trackDist - matched![0].trackDist)) < 1e-6,
    "withDistance prefers trackDist",
  );

  const series = compareLaps(matched!, mapMatchLap(noisySlow, thunderhill!)!);
  assert(series.length > 10, "compare series");
  assert(series.every((point) => Number.isFinite(point.delta)), "finite deltas");

  const corners = cornerBreakdown(
    {
      lapNumber: 1,
      lapTimeMs: 90000,
      points: matched!,
    },
    {
      lapNumber: 2,
      lapTimeMs: 92000,
      points: mapMatchLap(noisySlow, thunderhill!)!,
    },
  );
  assert(corners.length >= 1, "corners from matched laps");

  // parseCenterline accepts lon aliases.
  const parsed = parseCenterline([
    { lat: 1, longitude: 2 },
    { lat: 1.1, lng: 2.1 },
    { lat: 1.2, lon: 2.2 },
  ]);
  assert(parsed?.length === 3, "parse centerline aliases");

  // Built-in length roughly Thunderhill East (~4.6 km).
  let builtinLen = 0;
  for (let i = 1; i < thunderhill!.length; i += 1) {
    builtinLen += haversineMeters(
      thunderhill![i - 1].lat,
      thunderhill![i - 1].lon,
      thunderhill![i].lat,
      thunderhill![i].lon,
    );
  }
  assert(builtinLen > 3000 && builtinLen < 7000, `builtin length ${builtinLen}`);

  console.log(
    JSON.stringify({
      ok: true,
      hz: { trackaddict: 10, gopro: 18 },
      centerlinePoints: built!.length,
      builtinPoints: thunderhill!.length,
      builtinLenM: Math.round(builtinLen),
      rawLateralM: Number(rawLateral.toFixed(2)),
      snappedLateralM: Number(snappedLateral.toFixed(2)),
      compareSteps: series.length,
      corners: corners.length,
    }),
  );
}

main();
