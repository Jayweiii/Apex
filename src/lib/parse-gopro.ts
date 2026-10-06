import gpmfExtract from "gpmf-extract";
import goProTelemetryImport from "gopro-telemetry";
import { splitLapsByStartFinish } from "./split-laps";
import type { ParsedLap, TelemetryPoint } from "./types";

const GoProTelemetry =
  // CJS/ESM interop across bundlers
  (goProTelemetryImport as unknown as { default?: typeof goProTelemetryImport })
    .default ?? goProTelemetryImport;

type GpsSample = {
  value?: number[] | number[][];
  cts?: number;
  date?: string;
};

type AccelSample = {
  value?: number[] | number[][];
  cts?: number;
};

function asRows(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  if (value.length === 0) return [];
  if (typeof value[0] === "number") return [value as number[]];
  return value as number[][];
}

function pickDeviceStreams(telemetry: Record<string, unknown>) {
  const devices = Object.values(telemetry).filter(
    (value) => value && typeof value === "object",
  ) as Record<string, unknown>[];
  for (const device of devices) {
    const streams = device.streams as Record<string, unknown> | undefined;
    if (streams) return streams;
  }
  return null;
}

function readGpsStream(streams: Record<string, unknown>) {
  return (streams.GPS5 || streams.GPS9 || streams.GPS) as
    | { samples?: GpsSample[] }
    | undefined;
}

function readAccelStream(streams: Record<string, unknown>) {
  return (streams.ACCL || streams.ACCEL) as { samples?: AccelSample[] } | undefined;
}

function nearestAccel(
  samples: { t: number; latG: number; lonG: number }[],
  t: number,
) {
  if (!samples.length) return null;
  let best = samples[0];
  let bestDist = Math.abs(best.t - t);
  for (const sample of samples) {
    const dist = Math.abs(sample.t - t);
    if (dist < bestDist) {
      best = sample;
      bestDist = dist;
    }
  }
  return best;
}

export type GoProParseResult = {
  laps: ParsedLap[];
  pointCount: number;
  gpsStream: "GPS5" | "GPS9" | "GPS" | "unknown";
};

/**
 * Extract GPMF telemetry from a GoPro MP4 in the browser (or Node with a Buffer/File).
 * Uses GPS5/GPS9 for position+speed and ACCL for g when present.
 */
export async function parseGoProFile(
  file: File | Blob | Buffer,
  onProgress?: (percent: number) => void,
): Promise<GoProParseResult> {
  const extracted = await gpmfExtract(file as Blob, {
    browserMode: true,
    useWorker: false,
    progress: onProgress,
  });

  if (!extracted?.rawData) {
    throw new Error("No GPMF metadata track found in this video");
  }

  const parsed = (await GoProTelemetry(extracted, {
    stream: ["GPS", "ACCL"],
    repeatSticky: true,
  })) as unknown as Record<string, unknown>;

  const streams = pickDeviceStreams(parsed);
  if (!streams) {
    throw new Error("Could not read GoPro device streams from GPMF");
  }

  const gps = readGpsStream(streams);
  const gpsSamples = gps?.samples ?? [];
  if (!gpsSamples.length) {
    throw new Error(
      "This GoPro file has no GPS samples. Enable GPS on the camera (Hero5 and later) and try again.",
    );
  }

  const gpsStream: GoProParseResult["gpsStream"] = streams.GPS9
    ? "GPS9"
    : streams.GPS5
      ? "GPS5"
      : streams.GPS
        ? "GPS"
        : "unknown";

  const accel = readAccelStream(streams);
  const accelPoints =
    accel?.samples?.flatMap((sample) => {
      const rows = asRows(sample.value);
      const t = (sample.cts ?? 0) / 1000;
      return rows.map((row) => {
        // ACCL is typically m/s² in camera frame; approximate lon/lat g.
        const x = Number(row[0] ?? 0) / 9.80665;
        const y = Number(row[1] ?? 0) / 9.80665;
        return { t, lonG: Number(x.toFixed(3)), latG: Number(y.toFixed(3)) };
      });
    }) ?? [];

  const points: TelemetryPoint[] = [];
  for (const sample of gpsSamples) {
    const rows = asRows(sample.value);
    const t = (sample.cts ?? 0) / 1000;
    for (const row of rows) {
      // GPS5: lat, lon, alt, 2D speed (m/s), 3D speed, ...
      // GPS9: similar first fields for lat/lon/speed.
      const lat = Number(row[0]);
      const lon = Number(row[1]);
      const speedMs = Number(row[3] ?? row[4] ?? 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) continue;
      const g = nearestAccel(accelPoints, t);
      const point: TelemetryPoint = {
        t: Number(t.toFixed(3)),
        speed: Number((speedMs * 3.6).toFixed(2)),
        lat: Number(lat.toFixed(6)),
        lon: Number(lon.toFixed(6)),
      };
      if (g) {
        point.latG = g.latG;
        point.lonG = g.lonG;
      }
      points.push(point);
    }
  }

  if (points.length < 10) {
    throw new Error(
      "This GoPro file has no usable GPS fix. Wait for a lock before recording.",
    );
  }

  const laps = splitLapsByStartFinish(points);
  return { laps, pointCount: points.length, gpsStream };
}

/**
 * Merge multi-chapter GoPro files (separate MP4s) by concatenating time offsets.
 */
export async function parseGoProChapters(
  files: Array<File | Blob | Buffer>,
  onProgress?: (percent: number) => void,
): Promise<GoProParseResult> {
  if (!files.length) throw new Error("Choose at least one GoPro MP4");
  if (files.length === 1) return parseGoProFile(files[0], onProgress);

  const allPoints: TelemetryPoint[] = [];
  let timeOffset = 0;
  let gpsStream: GoProParseResult["gpsStream"] = "unknown";

  for (let i = 0; i < files.length; i += 1) {
    const chapter = await parseGoProFile(files[i], (percent) => {
      const overall = ((i + percent / 100) / files.length) * 100;
      onProgress?.(overall);
    });
    gpsStream = chapter.gpsStream;
    // Re-extract raw continuous points via lap merge is lossy; parse chapter points from laps.
    for (const lap of chapter.laps) {
      for (const point of lap.points) {
        allPoints.push({ ...point, t: point.t + timeOffset });
      }
      timeOffset += lap.lapTimeMs / 1000 + 0.5;
    }
  }

  const laps = splitLapsByStartFinish(allPoints);
  return { laps, pointCount: allPoints.length, gpsStream };
}
