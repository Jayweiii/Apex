import gpmfExtract from "gpmf-extract";
import goProTelemetryImport from "gopro-telemetry";
import {
  buildGpsQuality,
  type GpsFixType,
  type GpsQuality,
} from "./gps-quality";
import { splitLapsByStartFinish } from "./split-laps";
import type { ParsedLap, TelemetryPoint } from "./types";

const GoProTelemetry =
  (goProTelemetryImport as unknown as { default?: typeof goProTelemetryImport })
    .default ?? goProTelemetryImport;

/** Max DOP×100 kept (gopro-telemetry GPSPrecision). Under 500 is usually good. */
export const GOPRO_GPS_PRECISION_MAX = 500;
/** Min lock type kept (0 none, 2 2D, 3 3D). */
export const GOPRO_GPS_FIX_MIN = 2;

type GpsSample = {
  value?: number[] | number[][];
  cts?: number;
  date?: string;
  sticky?: Record<string, unknown>;
};

type AccelSample = {
  value?: number[] | number[][];
  cts?: number;
};

type GyroSample = {
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

/** Prefer GPS9 (newer Hero) then GPS5 then generic GPS. */
function readGpsStream(streams: Record<string, unknown>) {
  return (streams.GPS9 || streams.GPS5 || streams.GPS) as
    | { samples?: GpsSample[] }
    | undefined;
}

function readAccelStream(streams: Record<string, unknown>) {
  return (streams.ACCL || streams.ACCEL) as { samples?: AccelSample[] } | undefined;
}

function readGyroStream(streams: Record<string, unknown>) {
  return (streams.GYRO || streams.GYRO1) as { samples?: GyroSample[] } | undefined;
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

function stickyNumber(sample: GpsSample, keys: string[]): number | null {
  const sticky = sample.sticky ?? {};
  for (const key of keys) {
    const raw = sticky[key];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sampleFix(sample: GpsSample): GpsFixType | null {
  const n = stickyNumber(sample, ["GPSF", "fix", "FIX"]);
  if (n === 0 || n === 2 || n === 3) return n;
  return null;
}

function samplePrecision(sample: GpsSample): number | null {
  return stickyNumber(sample, ["GPSP", "precision", "DOP", "DOP100"]);
}

export type GoProParseResult = {
  laps: ParsedLap[];
  pointCount: number;
  gpsStream: "GPS5" | "GPS9" | "GPS" | "unknown";
  /** Epoch ms at video/GPMF t=0 (from GPS sample date − cts). */
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality: GpsQuality;
  /** True when GYRO samples were present (not yet used in charts). */
  hasGyro: boolean;
};

export type GoProParseOptions = {
  onProgress?: (percent: number) => void;
  /** Track start/finish for lap detection. */
  startFinish?: { lat: number; lon: number } | null;
  /** Override gopro-telemetry GPSPrecision (DOP×100). */
  gpsPrecisionMax?: number;
  /** Override gopro-telemetry GPSFix minimum. */
  gpsFixMin?: number;
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

function labelGpsStream(
  streams: Record<string, unknown>,
): GoProParseResult["gpsStream"] {
  if (streams.GPS9) return "GPS9";
  if (streams.GPS5) return "GPS5";
  if (streams.GPS) return "GPS";
  return "unknown";
}

/**
 * Parse already-extracted GPMF raw bytes (for fixtures / Node tests).
 * Same GPS quality filters as `parseGoProFile`.
 */
export async function parseGoProRawData(
  rawData: Buffer | ArrayBuffer | Uint8Array,
  options: GoProParseOptions = {},
): Promise<GoProParseResult> {
  const precisionMax = options.gpsPrecisionMax ?? GOPRO_GPS_PRECISION_MAX;
  const fixMin = options.gpsFixMin ?? GOPRO_GPS_FIX_MIN;

  const rawBytes: Uint8Array =
    rawData instanceof Uint8Array
      ? rawData
      : rawData instanceof ArrayBuffer
        ? new Uint8Array(rawData)
        : Buffer.isBuffer(rawData)
          ? new Uint8Array(rawData)
          : new Uint8Array(rawData as ArrayBuffer);

  let parsed: Record<string, unknown>;
  try {
    parsed = (await GoProTelemetry(
      // gopro-telemetry accepts Buffer | Uint8Array; cast for its typings.
      { rawData: rawBytes as Buffer },
      {
        stream: ["GPS", "ACCL", "GYRO"],
        repeatSticky: true,
        GPSPrecision: precisionMax,
        GPSFix: fixMin,
      },
    )) as unknown as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : "GPMF parse failed";
    throw new Error(
      `Could not parse GoPro GPMF telemetry (${message}). Use a Hero5+ clip with GPS enabled, or export GPX/JSON from Quik / Telemetry Overlay.`,
    );
  }

  const streams = pickDeviceStreams(parsed);
  if (!streams) {
    throw new Error(
      "Could not read GoPro device streams from GPMF. The file may lack a metadata track.",
    );
  }

  const gps = readGpsStream(streams);
  const gpsSamples = gps?.samples ?? [];
  if (!gpsSamples.length) {
    throw new Error(
      "This GoPro file has no GPS samples after quality filtering. Enable GPS on the camera (Hero5+), wait for a 3D lock, and avoid indoor starts — or import a Quik / Telemetry Overlay GPX/JSON export.",
    );
  }

  const gpsStream = labelGpsStream(streams);
  const startedAtMs = inferStartedAtMs(gpsSamples);
  const hasGyro = Boolean(readGyroStream(streams)?.samples?.length);

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
  let precisionSum = 0;
  let precisionCount = 0;
  let bestFix: GpsFixType | null = null;

  for (const sample of gpsSamples) {
    const rows = asRows(sample.value);
    const t = (sample.cts ?? 0) / 1000;
    const fix = sampleFix(sample);
    const precision = samplePrecision(sample);
    if (fix === 3 || (fix === 2 && bestFix !== 3)) bestFix = fix;
    if (precision != null) {
      precisionSum += precision;
      precisionCount += 1;
    }
    for (const row of rows) {
      const lat = Number(row[0]);
      const lon = Number(row[1]);
      // GPS5/GPS9: [lat, lon, alt, 2D m/s, 3D m/s, …]
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
      "This GoPro file has no usable GPS fix after dropping low-precision samples. Wait for a lock outdoors before recording.",
    );
  }

  let laps;
  try {
    laps = splitLapsByStartFinish(points, {
      sessionStartedAtMs: startedAtMs,
      startFinish: options.startFinish ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "lap split failed";
    throw new Error(
      `GoPro GPS was read (${points.length} points) but laps could not be detected (${message}). Drive a full lap past start/finish, or pass the track’s start/finish line.`,
    );
  }

  const avgPrecision =
    precisionCount > 0 ? Math.round(precisionSum / precisionCount) : null;

  return {
    laps,
    pointCount: points.length,
    gpsStream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
    hasGyro,
    gpsQuality: buildGpsQuality({
      stream: gpsStream,
      sampleCount: points.length,
      precisionP100: avgPrecision,
      fix: bestFix,
      sourceKind: "gopro",
    }),
  };
}

/**
 * Extract GPMF telemetry from a GoPro MP4 in the browser (or Node with a File/Blob).
 * Uses GPS9/GPS5 for position+speed (filtered by precision/fix), ACCL for g when
 * present, and notes GYRO availability. Preserves GPS date → startedAtMs.
 */
export async function parseGoProFile(
  file: File | Blob | Buffer,
  onProgressOrOptions?: ((percent: number) => void) | GoProParseOptions,
): Promise<GoProParseResult> {
  const options: GoProParseOptions =
    typeof onProgressOrOptions === "function"
      ? { onProgress: onProgressOrOptions }
      : onProgressOrOptions ?? {};

  let extracted: { rawData?: ArrayBuffer | Buffer | Uint8Array } | null;
  try {
    extracted = await gpmfExtract(file as Blob, {
      browserMode: true,
      useWorker: false,
      progress: options.onProgress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "extract failed";
    throw new Error(
      `Could not extract GPMF from this video (${message}). Confirm it is a GoPro Hero5+ MP4 with GPS, not a phone recording or YouTube download.`,
    );
  }

  if (!extracted?.rawData) {
    throw new Error(
      "No GPMF metadata track found in this video. Apex needs the original GoPro MP4 (YouTube strips GPMF). Export GPX/JSON from Quik or Telemetry Overlay instead.",
    );
  }

  return parseGoProRawData(extracted.rawData, options);
}

/**
 * Merge multi-chapter GoPro files by concatenating on each chapter's last cts
 * (not summed lap times).
 */
export async function parseGoProChapters(
  files: Array<File | Blob | Buffer>,
  onProgressOrOptions?: ((percent: number) => void) | GoProParseOptions,
): Promise<GoProParseResult> {
  const options: GoProParseOptions =
    typeof onProgressOrOptions === "function"
      ? { onProgress: onProgressOrOptions }
      : onProgressOrOptions ?? {};

  if (!files.length) throw new Error("Choose at least one GoPro MP4");
  if (files.length === 1) return parseGoProFile(files[0], options);

  const allPoints: TelemetryPoint[] = [];
  let timeOffset = 0;
  let gpsStream: GoProParseResult["gpsStream"] = "unknown";
  let startedAtMs: number | undefined;
  let hasGyro = false;
  let qualityParts: GpsQuality[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const chapter = await parseGoProFile(files[i], {
      ...options,
      onProgress: (percent) => {
        const overall = ((i + percent / 100) / files.length) * 100;
        options.onProgress?.(overall);
      },
    });
    gpsStream = chapter.gpsStream;
    hasGyro = hasGyro || chapter.hasGyro;
    qualityParts.push(chapter.gpsQuality);
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
    timeOffset = chapterEnd;
  }

  const laps = splitLapsByStartFinish(allPoints, {
    sessionStartedAtMs: startedAtMs,
    startFinish: options.startFinish ?? null,
  });

  const sampleCount = qualityParts.reduce((sum, q) => sum + q.sampleCount, 0);
  const precisionVals = qualityParts
    .map((q) => q.precisionP100)
    .filter((v): v is number => v != null);
  const avgPrecision = precisionVals.length
    ? Math.round(precisionVals.reduce((a, b) => a + b, 0) / precisionVals.length)
    : null;
  const bestFix = qualityParts.reduce<GpsFixType | null>((best, q) => {
    if (q.fix === 3) return 3;
    if (q.fix === 2 && best !== 3) return 2;
    return best;
  }, null);

  return {
    laps,
    pointCount: allPoints.length,
    gpsStream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
    hasGyro,
    gpsQuality: buildGpsQuality({
      stream: gpsStream,
      sampleCount,
      precisionP100: avgPrecision,
      fix: bestFix,
      sourceKind: "gopro",
    }),
  };
}
