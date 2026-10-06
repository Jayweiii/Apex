import gpmfExtract from "gpmf-extract";
import goProTelemetryImport from "gopro-telemetry";
import { splitLapsByStartFinish } from "./split-laps";
import type { ParsedLap, TelemetryPoint } from "./types";

const GoProTelemetry =
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
  /** Epoch ms at video/GPMF t=0 (from GPS sample date − cts). */
  startedAtMs?: number;
  sessionDate?: string;
};

function sessionDateFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inferStartedAtMs(samples: GpsSample[]): number | undefined {
  for (const sample of samples) {
    if (!sample.date) continue;
    const parsed = Date.parse(sample.date);
    if (!Number.isFinite(parsed)) continue;
    const ctsSec = (sample.cts ?? 0) / 1000;
    return Math.round(parsed - ctsSec * 1000);
  }
  return undefined;
}

/**
 * Extract GPMF telemetry from a GoPro MP4 in the browser (or Node with a Buffer/File).
 * Uses GPS5/GPS9 for position+speed and ACCL for g when present.
 * Preserves GPS date → startedAtMs and per-lap startOffsetSec (cts-based).
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

  const startedAtMs = inferStartedAtMs(gpsSamples);

  const accel = readAccelStream(streams);
  const accelPoints =
    accel?.samples?.flatMap((sample) => {
      const rows = asRows(sample.value);
      const t = (sample.cts ?? 0) / 1000;
      return rows.map((row) => {
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

  const laps = splitLapsByStartFinish(points, { sessionStartedAtMs: startedAtMs });
  return {
    laps,
    pointCount: points.length,
    gpsStream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
  };
}

/**
 * Merge multi-chapter GoPro files by concatenating on each chapter's last cts
 * (not summed lap times).
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
  let startedAtMs: number | undefined;

  for (let i = 0; i < files.length; i += 1) {
    const chapter = await parseGoProFile(files[i], (percent) => {
      const overall = ((i + percent / 100) / files.length) * 100;
      onProgress?.(overall);
    });
    gpsStream = chapter.gpsStream;
    if (i === 0) startedAtMs = chapter.startedAtMs;

    let chapterEnd = 0;
    for (const lap of chapter.laps) {
      const lapStart = lap.startOffsetSec ?? 0;
      for (const point of lap.points) {
        const t = point.t + lapStart + timeOffset;
        allPoints.push({ ...point, t });
        chapterEnd = Math.max(chapterEnd, t);
      }
    }
    // Advance by last sample time in this chapter (relative to chapter 0).
    timeOffset = chapterEnd;
  }

  const laps = splitLapsByStartFinish(allPoints, {
    sessionStartedAtMs: startedAtMs,
  });
  return {
    laps,
    pointCount: allPoints.length,
    gpsStream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
  };
}
