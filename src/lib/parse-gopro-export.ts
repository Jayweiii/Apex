/**
 * Parse separately exported GoPro telemetry (Quik / Telemetry Overlay / similar):
 * GPX, JSON, or CSV — without needing the original MP4.
 */
import { buildGpsQuality, type GpsQuality } from "./gps-quality";
import { splitLapsByStartFinish } from "./split-laps";
import type { ParsedLap, TelemetryPoint } from "./types";

export type GoProExportResult = {
  laps: ParsedLap[];
  pointCount: number;
  stream: "GPX" | "JSON" | "CSV";
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality: GpsQuality;
};

function sessionDateFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function haversineSpeedKmh(
  a: { lat: number; lon: number; t: number },
  b: { lat: number; lon: number; t: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  const meters = 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
  const dt = Math.max(0.001, b.t - a.t);
  return (meters / dt) * 3.6;
}

function finalize(
  points: TelemetryPoint[],
  stream: GoProExportResult["stream"],
  startedAtMs: number | undefined,
  startFinish?: { lat: number; lon: number } | null,
): GoProExportResult {
  if (points.length < 10) {
    throw new Error(
      `This ${stream} export has too few GPS points (${points.length}). Re-export from Quik or Telemetry Overlay with GPS enabled.`,
    );
  }
  const t0 = points[0].t;
  const normalized = points.map((point) => ({
    ...point,
    t: Number((point.t - t0).toFixed(3)),
  }));
  const laps = splitLapsByStartFinish(normalized, {
    sessionStartedAtMs: startedAtMs,
    startFinish: startFinish ?? null,
  });
  return {
    laps,
    pointCount: normalized.length,
    stream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
    gpsQuality: buildGpsQuality({
      stream,
      sampleCount: normalized.length,
      sourceKind: "gopro",
    }),
  };
}

/** Very small GPX parser for Quik / Telemetry Overlay track exports. */
export function parseGoProGpx(
  text: string,
  options?: { startFinish?: { lat: number; lon: number } | null },
): GoProExportResult {
  const trkpts = [
    ...text.matchAll(
      /<trkpt[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gi,
    ),
  ];
  if (!trkpts.length) {
    throw new Error(
      "No track points found in this GPX. Export a track (not a waypoint list) from Quik or Telemetry Overlay.",
    );
  }

  const raw: Array<{ lat: number; lon: number; t: number; speed?: number }> = [];
  let startedAtMs: number | undefined;
  for (const match of trkpts) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    const body = match[3] ?? "";
    const timeMatch = body.match(/<time>([^<]+)<\/time>/i);
    const speedMatch =
      body.match(/<speed>([^<]+)<\/speed>/i) ||
      body.match(/<gpxtpx:speed>([^<]+)<\/gpxtpx:speed>/i);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let t = raw.length;
    if (timeMatch) {
      const ms = Date.parse(timeMatch[1]);
      if (Number.isFinite(ms)) {
        if (startedAtMs == null) startedAtMs = ms;
        t = (ms - (startedAtMs ?? ms)) / 1000;
      }
    }
    const speedMs = speedMatch ? Number(speedMatch[1]) : NaN;
    raw.push({
      lat,
      lon,
      t,
      speed: Number.isFinite(speedMs) ? speedMs * 3.6 : undefined,
    });
  }

  const points: TelemetryPoint[] = raw.map((point, index) => {
    let speed = point.speed;
    if (speed == null && index > 0) {
      speed = haversineSpeedKmh(raw[index - 1], point);
    }
    return {
      t: Number(point.t.toFixed(3)),
      speed: Number((speed ?? 0).toFixed(2)),
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
    };
  });

  return finalize(points, "GPX", startedAtMs, options?.startFinish);
}

function collectJsonPoints(value: unknown, out: TelemetryPoint[], t0?: number) {
  if (!value) return t0;
  if (Array.isArray(value)) {
    // Array of samples
    if (
      value.length &&
      typeof value[0] === "object" &&
      value[0] != null &&
      ("lat" in (value[0] as object) || "latitude" in (value[0] as object))
    ) {
      let base = t0;
      for (const row of value as Record<string, unknown>[]) {
        const lat = Number(row.lat ?? row.latitude);
        const lon = Number(row.lon ?? row.lng ?? row.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const absT =
          row.t != null
            ? Number(row.t)
            : row.time != null
              ? Number(row.time)
              : row.cts != null
                ? Number(row.cts) / 1000
                : row.timestamp != null
                  ? Date.parse(String(row.timestamp)) / 1000
                  : out.length;
        if (!Number.isFinite(absT)) continue;
        if (base == null) base = absT;
        const speed =
          row.speed != null
            ? Number(row.speed)
            : row.speedKmh != null
              ? Number(row.speedKmh)
              : row.speed_mps != null
                ? Number(row.speed_mps) * 3.6
                : 0;
        out.push({
          t: Number((absT - base).toFixed(3)),
          speed: Number((Number.isFinite(speed) ? speed : 0).toFixed(2)),
          lat: Number(lat.toFixed(6)),
          lon: Number(lon.toFixed(6)),
        });
      }
      return base;
    }
    for (const item of value) collectJsonPoints(item, out, t0);
    return t0;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["data", "points", "samples", "telemetry", "gps", "track"]) {
      if (key in obj) collectJsonPoints(obj[key], out, t0);
    }
  }
  return t0;
}

export function parseGoProJson(
  text: string,
  options?: { startFinish?: { lat: number; lon: number } | null },
): GoProExportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON telemetry export.");
  }
  const points: TelemetryPoint[] = [];
  collectJsonPoints(data, points);
  if (points.length < 10) {
    throw new Error(
      "No GPS samples found in this JSON. Export telemetry from Quik or Telemetry Overlay.",
    );
  }
  return finalize(points, "JSON", undefined, options?.startFinish);
}

/** Lightweight CSV for exported GoPro/telemetry overlays (lat,lon,speed,time). */
export function parseGoProCsvExport(
  text: string,
  options?: { startFinish?: { lat: number; lon: number } | null },
): GoProExportResult {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length);
  if (lines.length < 2) {
    throw new Error("CSV export is empty.");
  }
  const header = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const latI = idx(["lat", "latitude"]);
  const lonI = idx(["lon", "lng", "longitude"]);
  const speedI = idx(["speed", "speed_kmh", "speedkmh", "spd"]);
  const timeI = idx(["time", "t", "timestamp", "cts", "datetime"]);
  if (latI < 0 || lonI < 0) {
    throw new Error(
      "CSV needs latitude and longitude columns (Quik / Telemetry Overlay export).",
    );
  }

  const points: TelemetryPoint[] = [];
  let startedAtMs: number | undefined;
  let t0: number | undefined;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(/[,;\t]/);
    const lat = Number(cols[latI]);
    const lon = Number(cols[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let t = points.length;
    if (timeI >= 0) {
      const raw = cols[timeI]?.trim() ?? "";
      const asNum = Number(raw);
      if (Number.isFinite(asNum)) {
        const abs = asNum > 1e12 ? asNum / 1000 : asNum;
        if (t0 == null) t0 = abs;
        t = abs - t0;
      } else {
        const ms = Date.parse(raw);
        if (Number.isFinite(ms)) {
          if (startedAtMs == null) startedAtMs = ms;
          t = (ms - (startedAtMs ?? ms)) / 1000;
        }
      }
    }
    const speed =
      speedI >= 0 && Number.isFinite(Number(cols[speedI]))
        ? Number(cols[speedI])
        : 0;
    points.push({
      t: Number(t.toFixed(3)),
      speed: Number(speed.toFixed(2)),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
    });
  }

  return finalize(points, "CSV", startedAtMs, options?.startFinish);
}

export function detectGoProExportKind(
  filename: string,
): "gpx" | "json" | "csv" | "mp4" | "unknown" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return "mp4";
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return "unknown";
}

export async function parseGoProExportFile(
  file: File | Blob,
  filename: string,
  options?: { startFinish?: { lat: number; lon: number } | null },
): Promise<GoProExportResult> {
  const kind = detectGoProExportKind(filename);
  const text = await file.text();
  if (kind === "gpx") return parseGoProGpx(text, options);
  if (kind === "json") return parseGoProJson(text, options);
  if (kind === "csv") return parseGoProCsvExport(text, options);
  throw new Error(
    `Unsupported GoPro export (${filename}). Use MP4, GPX, JSON, or CSV.`,
  );
}
