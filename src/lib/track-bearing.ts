import { clampProgress, sampleAtProgress, type GpsPoint } from "@/lib/scrub";

/** Compass bearing in degrees [0, 360) from point A → B. */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = (Math.atan2(y, x) * 180) / Math.PI;
  return ((θ % 360) + 360) % 360;
}

/** Shortest signed delta from a → b in degrees (−180, 180]. */
export function shortestAngleDelta(fromDeg: number, toDeg: number): number {
  let d = ((toDeg - fromDeg) % 360) + 360;
  d = d % 360;
  if (d > 180) d -= 360;
  return d;
}

type SampleOpts = {
  basis?: "time" | "track";
  durationSec?: number;
  t0?: number;
};

/** Instantaneous along-track bearing near `progress` (look-ahead). */
export function bearingAtProgress(
  points: GpsPoint[],
  progress: number,
  lookAhead = 0.012,
  sampleOpts?: SampleOpts,
): number {
  if (points.length < 2) return 0;
  const p = clampProgress(progress);
  const here = sampleAtProgress(points, p, sampleOpts);
  const ahead = sampleAtProgress(points, Math.min(1, p + lookAhead), sampleOpts);
  if (
    Math.abs(ahead.lat - here.lat) < 1e-9 &&
    Math.abs(ahead.lon - here.lon) < 1e-9
  ) {
    // Fall back to a slightly larger look-ahead, then previous segment.
    const ahead2 = sampleAtProgress(
      points,
      Math.min(1, p + lookAhead * 3),
      sampleOpts,
    );
    if (
      Math.abs(ahead2.lat - here.lat) > 1e-9 ||
      Math.abs(ahead2.lon - here.lon) > 1e-9
    ) {
      return bearingDeg(here.lat, here.lon, ahead2.lat, ahead2.lon);
    }
    const back = sampleAtProgress(
      points,
      Math.max(0, p - lookAhead),
      sampleOpts,
    );
    return bearingDeg(back.lat, back.lon, here.lat, here.lon);
  }
  return bearingDeg(here.lat, here.lon, ahead.lat, ahead.lon);
}

/**
 * Low-pass bearing for chase camera.
 * Samples a short window around progress and blends with previous with α.
 */
export function smoothBearingAtProgress(
  points: GpsPoint[],
  progress: number,
  previousDeg: number | null,
  options?: {
    lookAhead?: number;
    window?: number;
    alpha?: number;
    sampleOpts?: SampleOpts;
  },
): number {
  const lookAhead = options?.lookAhead ?? 0.012;
  const window = options?.window ?? 0.02;
  const alpha = options?.alpha ?? 0.22;
  const p = clampProgress(progress);
  const samples: number[] = [];
  for (let i = -2; i <= 2; i += 1) {
    const at = clampProgress(p + (i * window) / 4);
    samples.push(
      bearingAtProgress(points, at, lookAhead, options?.sampleOpts),
    );
  }
  // Circular mean via unit vectors.
  let sx = 0;
  let sy = 0;
  for (const deg of samples) {
    const rad = (deg * Math.PI) / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  }
  const mean =
    samples.length === 0
      ? 0
      : ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;

  if (previousDeg == null || !Number.isFinite(previousDeg)) return mean;
  const delta = shortestAngleDelta(previousDeg, mean);
  return ((previousDeg + alpha * delta) % 360 + 360) % 360;
}

/** Centroid of marker samples (for multi-lap chase framing). */
export function centroidLatLon(
  samples: Array<{ lat: number; lon: number }>,
): { lat: number; lon: number } | null {
  if (!samples.length) return null;
  let lat = 0;
  let lon = 0;
  for (const s of samples) {
    lat += s.lat;
    lon += s.lon;
  }
  return { lat: lat / samples.length, lon: lon / samples.length };
}
