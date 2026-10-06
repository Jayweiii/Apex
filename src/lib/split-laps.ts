import type { ParsedLap, TelemetryPoint } from "./types";

const EARTH_M = 6371000;

function haversineMeters(
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
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

function downsample(points: TelemetryPoint[], max = 400): TelemetryPoint[] {
  if (points.length <= max) return points;
  const result: TelemetryPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

/**
 * Split a continuous GPS trace into laps by returning near the start
 * after traveling a meaningful distance (start/finish approx).
 * Preserves each lap's startOffsetSec relative to the first sample's t.
 */
export function splitLapsByStartFinish(
  points: TelemetryPoint[],
  options?: {
    minLapMeters?: number;
    closeMeters?: number;
    sessionStartedAtMs?: number;
  },
): ParsedLap[] {
  if (points.length < 20) {
    throw new Error("Not enough GPS samples to build laps");
  }

  const moving = points.filter(
    (p) => (p.speed ?? 0) > 15 && p.lat != null && p.lon != null,
  );
  if (moving.length < 20) {
    throw new Error("No GPS motion found — is location enabled on the GoPro?");
  }

  const sessionStartT = points[0]?.t ?? moving[0].t;
  const start = moving[0];
  const minLapMeters = options?.minLapMeters ?? 400;
  const closeMeters = options?.closeMeters ?? 35;

  const segments: TelemetryPoint[][] = [];
  let current: TelemetryPoint[] = [];
  let traveled = 0;
  let prev = moving[0];

  for (const point of moving) {
    if (
      prev.lat != null &&
      prev.lon != null &&
      point.lat != null &&
      point.lon != null
    ) {
      traveled += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
    current.push(point);

    if (
      traveled >= minLapMeters &&
      start.lat != null &&
      start.lon != null &&
      point.lat != null &&
      point.lon != null
    ) {
      const distToStart = haversineMeters(
        start.lat,
        start.lon,
        point.lat,
        point.lon,
      );
      if (distToStart <= closeMeters) {
        segments.push(current);
        current = [];
        traveled = 0;
      }
    }
    prev = point;
  }
  if (current.length > 30 && traveled >= minLapMeters * 0.6) {
    segments.push(current);
  }

  const laps: ParsedLap[] = [];
  segments.forEach((segment, index) => {
    if (segment.length < 2) return;
    const t0 = segment[0].t;
    const startOffsetSec = Number((t0 - sessionStartT).toFixed(3));
    const normalized = segment.map((point) => ({
      ...point,
      t: Number((point.t - t0).toFixed(3)),
    }));
    const lapTimeMs = Math.max(
      0,
      Math.round(
        (normalized[normalized.length - 1].t - normalized[0].t) * 1000,
      ),
    );
    if (lapTimeMs < 1000) return;
    const startedAtMs =
      options?.sessionStartedAtMs != null
        ? Math.round(options.sessionStartedAtMs + startOffsetSec * 1000)
        : undefined;
    laps.push({
      lapNumber: index + 1,
      lapTimeMs,
      points: downsample(normalized),
      startOffsetSec,
      startedAtMs,
    });
  });

  if (!laps.length) {
    const t0 = moving[0].t;
    const startOffsetSec = Number((t0 - sessionStartT).toFixed(3));
    const normalized = moving.map((point) => ({
      ...point,
      t: Number((point.t - t0).toFixed(3)),
    }));
    laps.push({
      lapNumber: 1,
      lapTimeMs: Math.max(
        1000,
        Math.round(
          (normalized[normalized.length - 1].t - normalized[0].t) * 1000,
        ),
      ),
      points: downsample(normalized),
      startOffsetSec,
      startedAtMs:
        options?.sessionStartedAtMs != null
          ? Math.round(options.sessionStartedAtMs + startOffsetSec * 1000)
          : undefined,
    });
  }

  return laps;
}
