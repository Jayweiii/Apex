import gpmfExtract from "gpmf-extract";
import goProTelemetryImport from "gopro-telemetry";
import {
  buildGpsQuality,
  type GpsFixType,
  type GpsQuality,
} from "./gps-quality";
import { detectNearestTrack } from "./detect-track";
import type { LatLon } from "./map-match";
import { splitLapsByStartFinish } from "./split-laps";
import { resolveTrackCenterline } from "./cloud-tracks";
import { resolveTrackStartFinish } from "./track-start-finish";
import type { ParsedLap, TelemetryPoint } from "./types";

const GoProTelemetry =
  (goProTelemetryImport as unknown as { default?: typeof goProTelemetryImport })
    .default ?? goProTelemetryImport;

/** Max DOP×100 kept (gopro-telemetry GPSPrecision). Under 500 is usually good. */
export const GOPRO_GPS_PRECISION_MAX = 500;
/** Min lock type kept (0 none, 2 2D, 3 3D). */
export const GOPRO_GPS_FIX_MIN = 2;

/** Clear copy when GPMF exists but GPS9/GPS5/GPS streams are absent. */
export const GOPRO_NO_GPS_MESSAGE =
  "No GPS in this file. GPMF metadata is present, but there is no GPS9/GPS5 stream (short clips and some modes omit location). Use a longer outdoor recording with GPS enabled, or export GPX/JSON from Quik / Telemetry Overlay.";

export const GOPRO_NO_FIX_MESSAGE =
  "This GoPro file has no usable GPS fix after dropping unlocked samples (fix=0 / lat·lon=0). Wait for a 3D lock outdoors before recording, or import a Quik / Telemetry Overlay GPX export.";

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

/**
 * GPS9 value layout (Hero GPS9):
 * [lat, lon, alt, speed2d, speed3d, daysSince2000, secsSinceMidnight, DOP, fix]
 * GPS5 keeps fix/precision on sticky (GPSF / GPSP).
 */
export function gpsFixFromSample(
  sample: GpsSample,
  row?: number[],
): GpsFixType | null {
  if (row && row.length >= 9) {
    const fromValue = Number(row[8]);
    if (fromValue === 0 || fromValue === 2 || fromValue === 3) return fromValue;
  }
  const n = stickyNumber(sample, ["GPSF", "fix", "FIX"]);
  if (n === 0 || n === 2 || n === 3) return n;
  return null;
}

export function gpsDopFromSample(
  sample: GpsSample,
  row?: number[],
): number | null {
  if (row && row.length >= 8) {
    const dop = Number(row[7]);
    if (Number.isFinite(dop) && dop > 0) {
      // GPS9 stores raw DOP; gopro-telemetry GPSPrecision filter uses DOP×100.
      return dop < 50 ? Math.round(dop * 100) : Math.round(dop);
    }
  }
  return stickyNumber(sample, ["GPSP", "precision", "DOP", "DOP100"]);
}

/**
 * Drop unlocked samples: fix=0 and/or lat·lon ≈ 0 (Jason's 185MB Hero: 187
 * leading samples with fix 0 before 3D lock).
 */
export function isUsableGpsRow(
  row: number[],
  sample: GpsSample,
  fixMin: number,
): boolean {
  const lat = Number(row[0]);
  const lon = Number(row[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) return false;
  const fix = gpsFixFromSample(sample, row);
  if (typeof fix === "number" && fix < fixMin) return false;
  return true;
}

/**
 * gopro-telemetry ≥1.2 returns a Promise when no callback is given.
 * Calling it as a sync function yields `{}` — always await.
 */
export async function runGoProTelemetry(
  rawData: Buffer | Uint8Array,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = GoProTelemetry(
    { rawData: rawData as Buffer },
    options,
  ) as unknown;
  if (result != null && typeof (result as Promise<unknown>).then === "function") {
    return (await result) as Record<string, unknown>;
  }
  // Sync / empty fallback — treat blank objects as failure.
  if (
    result &&
    typeof result === "object" &&
    Object.keys(result as object).length > 0
  ) {
    return result as Record<string, unknown>;
  }
  throw new Error(
    "gopro-telemetry returned no data (did not await Promise?). Update Apex or pass a callback.",
  );
}

export type GoProClockSource = "gps" | "mp4" | "override" | "none";

export type GoProParseResult = {
  laps: ParsedLap[];
  pointCount: number;
  gpsStream: "GPS5" | "GPS9" | "GPS" | "unknown";
  /**
   * Absolute wall-clock at video t=0 for session date / time-of-day sync.
   * Prefer GPS-derived (sample.date − cts); fall back to MP4 creation_time
   * when GPS is missing or implausible. Manual override wins when provided.
   */
  startedAtMs?: number;
  sessionDate?: string;
  /** Raw GPS clock before plausibility / override resolution. */
  gpsDerivedStartedAtMs?: number;
  clockSource: GoProClockSource;
  gpsQuality: GpsQuality;
  /** True when GYRO samples were present (not yet used in charts). */
  hasGyro: boolean;
  /** Track used for SF / centerline (selected or auto-detected). */
  detectedTrackId?: string;
};

export type GoProParseOptions = {
  onProgress?: (percent: number) => void;
  /** Track start/finish for lap detection. */
  startFinish?: { lat: number; lon: number } | null;
  /** Track centerline for snap + SF progress wraps. */
  centerline?: LatLon[] | null;
  /**
   * Selected track id. When omitted, nearest catalog track is auto-detected
   * from GPS so SF / centerline can still drive lap splits.
   */
  trackId?: string | null;
  /** Override gopro-telemetry GPSPrecision (DOP×100). */
  gpsPrecisionMax?: number;
  /** Override gopro-telemetry GPSFix minimum. */
  gpsFixMin?: number;
  /**
   * MP4 mvhd / QuickTime creationdate — used when GPS clock is missing or
   * implausible (before 2015 or more than ~1 day in the future).
   */
  videoStartedAtMs?: number;
  /** Manual absolute clock at video t=0 (wins over GPS and MP4). */
  overrideStartedAtMs?: number;
};

/** GoPro / Apex era floor — reject epoch-zero and ancient garbage clocks. */
export const GPS_CLOCK_MIN_MS = Date.UTC(2015, 0, 1);

export function isPlausibleSessionClockMs(
  ms: number,
  nowMs: number = Date.now(),
): boolean {
  if (!Number.isFinite(ms)) return false;
  if (ms < GPS_CLOCK_MIN_MS) return false;
  // Allow ~1 day of future skew (device clock / TZ quirks).
  if (ms > nowMs + 24 * 60 * 60 * 1000) return false;
  return true;
}

/**
 * Resolve session absolute time: override → plausible GPS → plausible MP4.
 */
export function resolveGoProStartedAtMs(input: {
  gpsDerivedStartedAtMs?: number;
  mp4CreationTimeMs?: number;
  overrideStartedAtMs?: number;
  nowMs?: number;
}): { startedAtMs?: number; clockSource: GoProClockSource } {
  const now = input.nowMs ?? Date.now();
  if (
    input.overrideStartedAtMs != null &&
    isPlausibleSessionClockMs(input.overrideStartedAtMs, now)
  ) {
    return { startedAtMs: input.overrideStartedAtMs, clockSource: "override" };
  }
  if (
    input.gpsDerivedStartedAtMs != null &&
    isPlausibleSessionClockMs(input.gpsDerivedStartedAtMs, now)
  ) {
    return { startedAtMs: input.gpsDerivedStartedAtMs, clockSource: "gps" };
  }
  if (
    input.mp4CreationTimeMs != null &&
    isPlausibleSessionClockMs(input.mp4CreationTimeMs, now)
  ) {
    return { startedAtMs: input.mp4CreationTimeMs, clockSource: "mp4" };
  }
  return { clockSource: "none" };
}

function sessionDateFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** GPS sample.date − cts → absolute wall-clock at video t=0. */
export function inferGpsDerivedStartedAtMs(
  samples: GpsSample[],
): number | undefined {
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

/** Build telemetry points from already-decoded GPS samples (unit-testable). */
export function pointsFromGpsSamples(
  gpsSamples: GpsSample[],
  accelPoints: { t: number; latG: number; lonG: number }[],
  fixMin: number,
): {
  points: TelemetryPoint[];
  bestFix: GpsFixType | null;
  avgPrecisionP100: number | null;
  droppedNoFix: number;
} {
  const points: TelemetryPoint[] = [];
  let precisionSum = 0;
  let precisionCount = 0;
  let bestFix: GpsFixType | null = null;
  let droppedNoFix = 0;

  for (const sample of gpsSamples) {
    const rows = asRows(sample.value);
    const t = (sample.cts ?? 0) / 1000;
    for (const row of rows) {
      const fix = gpsFixFromSample(sample, row);
      const precision = gpsDopFromSample(sample, row);
      if (!isUsableGpsRow(row, sample, fixMin)) {
        droppedNoFix += 1;
        continue;
      }
      if (fix === 3 || (fix === 2 && bestFix !== 3)) bestFix = fix;
      if (precision != null) {
        precisionSum += precision;
        precisionCount += 1;
      }
      const lat = Number(row[0]);
      const lon = Number(row[1]);
      const speedMs = Number(row[3] ?? row[4] ?? 0);
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

  return {
    points,
    bestFix,
    avgPrecisionP100:
      precisionCount > 0 ? Math.round(precisionSum / precisionCount) : null,
    droppedNoFix,
  };
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
    // Explicit GPS9 + GPS5 — Hero GPS9 is not covered by stream:["GPS"] alone.
    parsed = await runGoProTelemetry(rawBytes, {
      stream: ["GPS9", "GPS5", "GPS", "ACCL", "GYRO"],
      repeatSticky: true,
      GPSPrecision: precisionMax,
      GPSFix: fixMin,
    });
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

  if (!streams.GPS9 && !streams.GPS5 && !streams.GPS) {
    throw new Error(GOPRO_NO_GPS_MESSAGE);
  }

  const gps = readGpsStream(streams);
  const gpsSamples = gps?.samples ?? [];
  if (!gpsSamples.length) {
    throw new Error(GOPRO_NO_GPS_MESSAGE);
  }

  const gpsStream = labelGpsStream(streams);
  const gpsDerivedStartedAtMs = inferGpsDerivedStartedAtMs(gpsSamples);
  const resolved = resolveGoProStartedAtMs({
    gpsDerivedStartedAtMs,
    mp4CreationTimeMs: options.videoStartedAtMs,
    overrideStartedAtMs: options.overrideStartedAtMs,
  });
  const startedAtMs = resolved.startedAtMs;
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

  const { points, bestFix, avgPrecisionP100 } = pointsFromGpsSamples(
    gpsSamples,
    accelPoints,
    fixMin,
  );

  if (points.length < 10) {
    throw new Error(GOPRO_NO_FIX_MESSAGE);
  }

  const split = splitGoProLaps(points, {
    sessionStartedAtMs: startedAtMs,
    startFinish: options.startFinish ?? null,
    centerline: options.centerline ?? null,
    trackId: options.trackId ?? null,
  });

  return {
    laps: split.laps,
    pointCount: points.length,
    gpsStream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
    gpsDerivedStartedAtMs,
    clockSource: resolved.clockSource,
    hasGyro,
    detectedTrackId: split.detectedTrackId,
    gpsQuality: buildGpsQuality({
      stream: gpsStream,
      sampleCount: points.length,
      precisionP100: avgPrecisionP100,
      fix: bestFix,
      sourceKind: "gopro",
    }),
  };
}

/**
 * Resolve track geometry (selected → auto-detect nearest) and split laps on
 * SF crossings / centerline progress wraps. Shared by single-file and chapter
 * parsers so GPS points are only extracted once.
 */
export function splitGoProLaps(
  points: TelemetryPoint[],
  options: {
    sessionStartedAtMs?: number;
    startFinish?: { lat: number; lon: number } | null;
    centerline?: LatLon[] | null;
    trackId?: string | null;
  } = {},
): { laps: ParsedLap[]; detectedTrackId?: string } {
  let trackId = options.trackId ?? null;
  if (!trackId) {
    trackId = detectNearestTrack(points)?.id ?? null;
  }

  let startFinish = options.startFinish ?? null;
  let centerline = options.centerline ?? null;
  if (trackId) {
    // Do not pass the whole session as sampleLaps — that builds a multi-lap
    // blob centerline and over-splits on progress wraps.
    if (!centerline) {
      centerline = resolveTrackCenterline(trackId, null);
    }
    if (!startFinish) {
      startFinish = resolveTrackStartFinish(trackId);
    }
  }

  try {
    const laps = splitLapsByStartFinish(points, {
      sessionStartedAtMs: options.sessionStartedAtMs,
      startFinish,
      centerline,
    });
    return {
      laps,
      detectedTrackId: trackId ?? undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "lap split failed";
    throw new Error(
      `GoPro GPS was read (${points.length} points) but laps could not be detected (${message}). Drive a full lap past start/finish, or pass the track’s start/finish line.`,
    );
  }
}

/**
 * Extract GPMF from a GoPro MP4/LRV/MOV.
 * In the browser, `gpmf-extract` reads the File in ~2MB blocks (File.slice /
 * workers) so multi-GB clips are not loaded wholesale into RAM. Only the
 * metadata track bytes (~few MB) are passed to gopro-telemetry.
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
    // Pass File/Blob through — browserMode uses block readers, not full buffer.
    extracted = await gpmfExtract(file as Blob, {
      browserMode: true,
      useWorker: false,
      progress: options.onProgress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "extract failed";
    throw new Error(
      `Could not extract GPMF from this video (${message}). Confirm it is a GoPro Hero5+ MP4/LRV/MOV with GPS, not a phone recording or YouTube download.`,
    );
  }

  if (!extracted?.rawData) {
    throw new Error(
      "No GPMF metadata track found in this video. Apex needs the original GoPro MP4/LRV (YouTube strips GPMF). Export GPX/JSON from Quik or Telemetry Overlay instead.",
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

  if (!files.length) throw new Error("Choose at least one GoPro MP4/LRV/MOV");
  if (files.length === 1) return parseGoProFile(files[0], options);

  const allPoints: TelemetryPoint[] = [];
  let timeOffset = 0;
  let gpsStream: GoProParseResult["gpsStream"] = "unknown";
  let startedAtMs: number | undefined;
  let gpsDerivedStartedAtMs: number | undefined;
  let clockSource: GoProClockSource = "none";
  let hasGyro = false;
  let qualityParts: GpsQuality[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const chapter = await parseGoProFile(files[i], {
      ...options,
      // Only first chapter supplies absolute clocks.
      videoStartedAtMs: i === 0 ? options.videoStartedAtMs : undefined,
      overrideStartedAtMs: i === 0 ? options.overrideStartedAtMs : undefined,
      onProgress: (percent) => {
        const overall = ((i + percent / 100) / files.length) * 100;
        options.onProgress?.(overall);
      },
    });
    gpsStream = chapter.gpsStream;
    hasGyro = hasGyro || chapter.hasGyro;
    qualityParts.push(chapter.gpsQuality);
    if (i === 0) {
      startedAtMs = chapter.startedAtMs;
      gpsDerivedStartedAtMs = chapter.gpsDerivedStartedAtMs;
      clockSource = chapter.clockSource;
    }

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

  const split = splitGoProLaps(allPoints, {
    sessionStartedAtMs: startedAtMs,
    startFinish: options.startFinish ?? null,
    centerline: options.centerline ?? null,
    trackId: options.trackId ?? null,
  });
  const laps = split.laps;

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
    gpsDerivedStartedAtMs,
    clockSource,
    hasGyro,
    detectedTrackId: split.detectedTrackId,
    gpsQuality: buildGpsQuality({
      stream: gpsStream,
      sampleCount,
      precisionP100: avgPrecision,
      fix: bestFix,
      sourceKind: "gopro",
    }),
  };
}

/** True for GoPro media containers we accept for GPMF parse. */
export function isGoProMediaFilename(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".lrv") ||
    lower.endsWith(".mov")
  );
}
