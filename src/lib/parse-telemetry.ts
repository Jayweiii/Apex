import Papa from "papaparse";
import type { ParsedLap, TelemetryPoint } from "./types";

const LAP_KEYS = ["lap", "lap_number", "lapnumber", "lap_index", "lap_n"];
const TIME_KEYS = [
  "time",
  "timestamp",
  "t",
  "elapsed",
  "elapsed_time",
  "gps_time",
  "utc",
  "session_time",
];
const SPEED_KEYS = [
  "speed",
  "speed_kmh",
  "speed_kph",
  "speed_mph",
  "velocity",
  "v",
  "gps_speed",
];
const DISTANCE_KEYS = ["distance", "dist", "odometer", "s"];
const LAT_KEYS = ["latitude", "gps_latitude", "gps_lat", "lat"];
const LON_KEYS = ["longitude", "gps_longitude", "gps_lon", "gps_lng", "lon", "lng"];
const LAT_G_KEYS = [
  "lat_g",
  "lateral_g",
  "g_lat",
  "lateral_accel",
  "gps_latacc",
  "accel_y",
  "ay",
];
const LON_G_KEYS = [
  "long_g",
  "lon_g",
  "lng_g",
  "longitudinal_g",
  "g_long",
  "long_accel",
  "gps_lonacc",
  "accel_x",
  "ax",
];

const MAX_POINTS = 400;

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    // Keep units from parentheses so "Speed (MPH)" → "speed_mph".
    .replace(/\(([^)]*)\)/g, (_, unit: string) => ` ${unit} `)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/_+/g, "_");
}

function findColumn(headers: string[], keys: string[]): string | null {
  for (const key of keys) {
    const match = headers.find((h) => h === key);
    if (match) return match;
  }
  for (const key of keys) {
    if (key.length < 3) continue;
    const match = headers.find((h) => h.includes(key));
    if (match) return match;
  }
  return null;
}

function parseTimeValue(raw: string, treatAsMs: boolean): number | null {
  const value = raw.trim();
  if (!value) return null;

  if (value.includes(":")) {
    const parts = value.split(":");
    if (parts.length === 3) {
      const [h, m, s] = parts;
      return Number(h) * 3600 + Number(m) * 60 + Number(s);
    }
    if (parts.length === 2) {
      const [m, s] = parts;
      return Number(m) * 60 + Number(s);
    }
  }

  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return treatAsMs ? n / 1000 : n;
}

function parseNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) ? n : null;
}

function toG(value: number | null, header: string): number | null {
  if (value == null) return null;
  const alreadyG =
    header === "g" ||
    header.endsWith("_g") ||
    header.startsWith("g_") ||
    header.includes("gforce") ||
    // TrackAddict Accel X/Y/Z columns are already in g.
    header.startsWith("accel_");
  return alreadyG ? value : value / 9.80665;
}

function speedToKmh(speed: number, header: string): number {
  if (header.includes("mph")) return speed * 1.60934;
  if (header.includes("m_s") || header.includes("ms") || header.endsWith("_mps")) {
    return speed * 3.6;
  }
  return speed;
}

function downsample(points: TelemetryPoint[], max = MAX_POINTS): TelemetryPoint[] {
  if (points.length <= max) return points;
  const result: TelemetryPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

type Sample = {
  lap: number | null;
  t: number;
  speed: number;
  distance: number | null;
  lat: number | null;
  lon: number | null;
  latG: number | null;
  lonG: number | null;
};

type LapSample = {
  tAbs: number;
  speed: number;
  lat: number | null;
  lon: number | null;
  latG: number | null;
  lonG: number | null;
};

export function parseTelemetryCsv(csv: string): ParsedLap[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    // TrackAddict / RaceRender exports start with "# …" metadata lines.
    comments: "#",
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0]?.message ?? "Could not parse CSV");
  }

  const headers = parsed.meta.fields?.map(normalizeHeader) ?? [];
  if (!headers.length) {
    throw new Error("CSV is missing a header row");
  }

  const lapCol = findColumn(headers, LAP_KEYS);
  const timeCol = findColumn(headers, TIME_KEYS);
  const speedCol = findColumn(headers, SPEED_KEYS);
  const distanceCol = findColumn(headers, DISTANCE_KEYS);
  const latGCol = findColumn(headers, LAT_G_KEYS);
  const lonGCol = findColumn(headers, LON_G_KEYS);
  const positionHeaders = headers.filter(
    (header) => header !== latGCol && header !== lonGCol,
  );
  const latCol = findColumn(positionHeaders, LAT_KEYS);
  const lonCol = findColumn(positionHeaders, LON_KEYS);

  if (!timeCol) {
    throw new Error("CSV needs a time column (time, timestamp, elapsed, …)");
  }
  if (!speedCol) {
    throw new Error("CSV needs a speed column (speed, speed_kph, velocity, …)");
  }

  const timeLooksLikeMs = timeCol.includes("ms") || timeCol.includes("millis");
  const samples: Sample[] = [];

  for (const row of parsed.data) {
    const t = parseTimeValue(String(row[timeCol] ?? ""), timeLooksLikeMs);
    const speedRaw = parseNumber(row[speedCol]);
    if (t == null || speedRaw == null) continue;

    const lat = latCol ? parseNumber(row[latCol]) : null;
    const lon = lonCol ? parseNumber(row[lonCol]) : null;
    samples.push({
      lap: lapCol ? parseNumber(row[lapCol]) : null,
      t,
      speed: speedToKmh(speedRaw, speedCol),
      distance: distanceCol ? parseNumber(row[distanceCol]) : null,
      lat: lat != null && lat >= -90 && lat <= 90 ? lat : null,
      lon: lon != null && lon >= -180 && lon <= 180 ? lon : null,
      latG: latGCol ? toG(parseNumber(row[latGCol]), latGCol) : null,
      lonG: lonGCol ? toG(parseNumber(row[lonGCol]), lonGCol) : null,
    });
  }

  if (samples.length < 2) {
    throw new Error("Not enough valid telemetry rows to build laps");
  }

  const medianTime = [...samples.map((s) => s.t)].sort((a, b) => a - b)[
    Math.floor(samples.length / 2)
  ];
  const scale = !timeLooksLikeMs && medianTime > 100_000 ? 0.001 : 1;
  for (const sample of samples) sample.t *= scale;

  const groups = groupIntoLaps(samples, Boolean(lapCol));
  const laps: ParsedLap[] = [];

  for (const [lapNumber, points] of groups) {
    if (points.length < 2) continue;
    const start = points[0].tAbs;
    const end = points[points.length - 1].tAbs;
    const lapTimeMs = Math.max(0, Math.round((end - start) * 1000));
    if (lapTimeMs < 1000) continue;

    const telemetry = downsample(
      points.map((p) => {
        const point: TelemetryPoint = {
          t: Number((p.tAbs - start).toFixed(3)),
          speed: Number(p.speed.toFixed(2)),
        };
        if (p.lat != null && p.lon != null) {
          point.lat = Number(p.lat.toFixed(6));
          point.lon = Number(p.lon.toFixed(6));
        }
        if (p.latG != null) point.latG = Number(p.latG.toFixed(3));
        if (p.lonG != null) point.lonG = Number(p.lonG.toFixed(3));
        return point;
      }),
    );

    laps.push({ lapNumber, lapTimeMs, points: telemetry });
  }

  if (!laps.length) {
    throw new Error("No complete laps found in this file");
  }

  return laps.sort((a, b) => a.lapNumber - b.lapNumber);
}

function groupIntoLaps(
  samples: Sample[],
  hasLapColumn: boolean,
): Map<number, LapSample[]> {
  const groups = new Map<number, LapSample[]>();

  if (hasLapColumn && samples.some((s) => s.lap != null)) {
    for (const sample of samples) {
      const lapNumber = Math.round(sample.lap ?? 0);
      if (lapNumber <= 0) continue;
      push(groups, lapNumber, sample);
    }
    return groups;
  }

  let lapNumber = 1;
  let previous = samples[0];
  push(groups, lapNumber, previous);

  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    const timeReset = sample.t + 1 < previous.t;
    const distanceReset =
      previous.distance != null &&
      sample.distance != null &&
      sample.distance + 20 < previous.distance;
    if (timeReset || distanceReset) {
      lapNumber += 1;
    }
    push(groups, lapNumber, sample);
    previous = sample;
  }

  return groups;
}

function push(groups: Map<number, LapSample[]>, lapNumber: number, sample: Sample) {
  const list = groups.get(lapNumber) ?? [];
  list.push({
    tAbs: sample.t,
    speed: sample.speed,
    lat: sample.lat,
    lon: sample.lon,
    latG: sample.latG,
    lonG: sample.lonG,
  });
  groups.set(lapNumber, list);
}
