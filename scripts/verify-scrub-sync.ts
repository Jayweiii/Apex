import {
  clampProgress,
  indexFromProgress,
  progressFromIndex,
  progressNearPoint,
  sampleAtProgress,
  type GpsPoint,
} from "../src/lib/scrub";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function main() {
  assert(clampProgress(-1) === 0, "clamp low");
  assert(clampProgress(2) === 1, "clamp high");
  assert(progressFromIndex(null, 10) == null, "null index");
  assert(progressFromIndex(5, 11) === 0.5, "mid index");
  assert(indexFromProgress(0.5, 11) === 5, "mid progress");

  const withDist: GpsPoint[] = [
    { t: 0, speed: 100, lat: 39.54, lon: -122.33, trackDist: 0 },
    { t: 10, speed: 110, lat: 39.541, lon: -122.331, trackDist: 100 },
    { t: 20, speed: 90, lat: 39.542, lon: -122.332, trackDist: 200 },
  ];

  const mid = sampleAtProgress(withDist, 0.5);
  assert(Math.abs((mid.trackDist ?? 0) - 100) < 1e-6, "sample mid trackDist");
  assert(Math.abs(mid.lat - 39.541) < 1e-9, "sample mid lat");

  const near = progressNearPoint(withDist, 39.541, -122.331, haversine);
  assert(Math.abs(near.progress - 0.5) < 0.05, "near mid progress");

  // Index-based fallback when no trackDist.
  const raw: GpsPoint[] = [
    { t: 0, speed: 80, lat: 1, lon: 1 },
    { t: 1, speed: 90, lat: 2, lon: 2 },
    { t: 2, speed: 100, lat: 3, lon: 3 },
  ];
  const end = sampleAtProgress(raw, 1);
  assert(end.lat === 3 && end.lon === 3, "sample end without trackDist");

  console.log(
    JSON.stringify({
      ok: true,
      chartToMap: "progress 0..1 shared",
      mapToChart: "indexFromProgress",
      distanceAware: true,
    }),
  );
}

main();
