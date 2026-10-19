/**
 * General GPS-logger importers: GPX, VBO (RaceLogic/Dragy-style), Dragy CSV,
 * plus friendly rejection of native Dragy .dlap (encrypted zip).
 */
import { buildGpsQuality, type GpsQuality } from "./gps-quality";
import {
  parseGoProCsvExport,
  parseGoProGpx,
  parseGoProJson,
} from "./parse-gopro-export";
import { splitLapsByStartFinish } from "./split-laps";
import type { ParsedLap, TelemetryPoint } from "./types";

export type GpsLoggerFormat =
  | "gpx"
  | "vbo"
  | "dragy-csv"
  | "gopro-csv"
  | "gopro-json"
  | "trackaddict-csv"
  | "dlap"
  | "mp4"
  | "unknown";

export type GpsLoggerResult = {
  laps: ParsedLap[];
  pointCount: number;
  format: GpsLoggerFormat;
  stream: GpsQuality["stream"];
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality: GpsQuality;
  /** Hints from .dlap PNG names (never a successful parse). */
  dlapHints?: DlapHints;
};

export type DlapHints = {
  trackNameHint?: string;
  sessionDateHint?: string;
  pngNames: string[];
  message: string;
};

export type GpsLoggerParseOptions = {
  startFinish?: { lat: number; lon: number } | null;
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

function finalizeLogger(
  points: TelemetryPoint[],
  format: GpsLoggerFormat,
  stream: GpsQuality["stream"],
  startedAtMs: number | undefined,
  startFinish?: { lat: number; lon: number } | null,
): GpsLoggerResult {
  if (points.length < 10) {
    throw new Error(
      `This ${stream} export has too few GPS points (${points.length}). Re-export with GPS enabled.`,
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
    format,
    stream,
    startedAtMs,
    sessionDate: startedAtMs != null ? sessionDateFromMs(startedAtMs) : undefined,
    gpsQuality: buildGpsQuality({
      stream,
      sampleCount: normalized.length,
      sourceKind: stream === "CSV" && format === "trackaddict-csv" ? "csv" : "logger",
    }),
  };
}

/** RaceLogic VBO stores lat/lon as minutes (±DDMM.mmmm); convert when |value| > 90. */
export function vboCoordToDegrees(raw: number): number {
  if (!Number.isFinite(raw)) return NaN;
  if (Math.abs(raw) <= 90) return raw;
  const sign = raw < 0 ? -1 : 1;
  return sign * (Math.abs(raw) / 60);
}

/**
 * Parse RaceLogic / VBOX / Dragy-style VBO text.
 * Expects `[column names]` then `[data]` sections.
 */
export function parseVbo(
  text: string,
  options?: GpsLoggerParseOptions,
): GpsLoggerResult {
  const namesMatch = text.match(
    /\[column names\]\s*([\s\S]*?)(?=\[[^\]]+\]|$)/i,
  );
  const dataMatch = text.match(/\[data\]\s*([\s\S]*?)(?=\[[^\]]+\]|$)/i);
  if (!namesMatch || !dataMatch) {
    throw new Error(
      "This does not look like a VBO file (missing [column names] / [data]). Export VBO from Dragy or RaceLogic VBOX Tools.",
    );
  }
  const columns = namesMatch[1]
    .trim()
    .split(/\s+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (!columns.length) {
    throw new Error("VBO [column names] section is empty.");
  }

  const findCol = (...aliases: string[]) =>
    columns.findIndex((c) => aliases.some((a) => c === a || c.includes(a)));

  const latI = findCol("latitude", "lat");
  const lonI = findCol("longitude", "long", "lon", "lng");
  const timeI = findCol("time");
  const speedI = findCol("velocity", "speed", "spd");
  if (latI < 0 || lonI < 0) {
    throw new Error(
      "VBO needs latitude and longitude columns under [column names].",
    );
  }

  const dataLines = dataMatch[1]
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length && !line.startsWith("["));

  const raw: Array<{ lat: number; lon: number; t: number; speed?: number }> = [];
  let t0: number | undefined;
  for (const line of dataLines) {
    const cols = line.split(/\s+/);
    if (cols.length < columns.length && cols.length < 3) continue;
    const lat = vboCoordToDegrees(Number(cols[latI]));
    const lon = vboCoordToDegrees(Number(cols[lonI]));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) < 0.001 && Math.abs(lon) < 0.001) continue;

    let t = raw.length * 0.1;
    if (timeI >= 0 && Number.isFinite(Number(cols[timeI]))) {
      const abs = Number(cols[timeI]);
      if (t0 == null) t0 = abs;
      t = abs - t0;
    }
    let speed: number | undefined;
    if (speedI >= 0 && Number.isFinite(Number(cols[speedI]))) {
      // VBOX velocity is typically km/h already.
      speed = Number(cols[speedI]);
    }
    raw.push({ lat, lon, t, speed });
  }

  const points: TelemetryPoint[] = raw.map((point, index) => {
    let speed = point.speed;
    if ((speed == null || speed === 0) && index > 0) {
      speed = haversineSpeedKmh(raw[index - 1], point);
    }
    return {
      t: Number(point.t.toFixed(3)),
      speed: Number((speed ?? 0).toFixed(2)),
      lat: Number(point.lat.toFixed(6)),
      lon: Number(point.lon.toFixed(6)),
    };
  });

  return finalizeLogger(points, "vbo", "VBO", undefined, options?.startFinish);
}

/**
 * Dragy CSV export — autodetect time / lat / lon / speed / heading / altitude.
 * Speed may be km/h or m/s; heading/altitude stored only when mapping to points
 * that support them (speed + lat/lon are required for laps).
 */
export function parseDragyCsv(
  text: string,
  options?: GpsLoggerParseOptions,
): GpsLoggerResult {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim().length);
  if (lines.length < 2) throw new Error("Dragy CSV is empty.");

  const delim = lines[0].includes(";")
    ? ";"
    : lines[0].includes("\t")
      ? "\t"
      : ",";
  const header = lines[0]
    .split(delim)
    .map((h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/^\ufeff/, "")
        .replace(/["']/g, "")
        .replace(/\s*\([^)]*\)\s*/g, " ")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, ""),
    );

  const idx = (...names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.includes(n)));

  const latI = idx("latitude", "lat", "gps_lat");
  const lonI = idx("longitude", "lon", "lng", "long", "gps_lon");
  const speedI = idx(
    "speed_kmh",
    "speed_kph",
    "speed",
    "velocity",
    "spd",
    "gps_speed",
  );
  const timeI = idx(
    "time",
    "timestamp",
    "datetime",
    "date_time",
    "utc_time",
    "t",
  );
  // heading / altitude detected for future use; not required on TelemetryPoint yet
  void idx("heading", "bearing", "course", "yaw");
  void idx("altitude", "alt", "elevation", "height");

  if (latI < 0 || lonI < 0) {
    throw new Error(
      "Dragy CSV needs latitude and longitude columns. Export CSV from Dragy (Share → CSV).",
    );
  }

  const speedHeader = speedI >= 0 ? header[speedI] : "";
  const speedLooksMs =
    /m_?s|mps|metres_per|meters_per/.test(speedHeader) ||
    speedHeader.endsWith("_ms");

  const points: TelemetryPoint[] = [];
  let startedAtMs: number | undefined;
  let t0: number | undefined;

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    const lat = Number(cols[latI]);
    const lon = Number(cols[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    let t = points.length * 0.1;
    if (timeI >= 0) {
      const raw = cols[timeI] ?? "";
      const asNum = Number(raw);
      if (Number.isFinite(asNum) && raw !== "") {
        // epoch ms, epoch s, or relative seconds
        const abs =
          asNum > 1e12 ? asNum / 1000 : asNum > 1e9 ? asNum : asNum;
        if (asNum > 1e9) {
          const ms = asNum > 1e12 ? asNum : asNum * 1000;
          if (startedAtMs == null) startedAtMs = ms;
          t = (ms - (startedAtMs ?? ms)) / 1000;
        } else {
          if (t0 == null) t0 = abs;
          t = abs - t0;
        }
      } else {
        const ms = Date.parse(raw);
        if (Number.isFinite(ms)) {
          if (startedAtMs == null) startedAtMs = ms;
          t = (ms - (startedAtMs ?? ms)) / 1000;
        }
      }
    }

    let speed = 0;
    if (speedI >= 0 && Number.isFinite(Number(cols[speedI]))) {
      speed = Number(cols[speedI]);
      if (speedLooksMs) speed *= 3.6;
      // Dragy sometimes exports m/s without saying so — if max < 80 and looks slow, leave as km/h guess;
      // if values are typically < 80 for a track day car that's fine as km/h too.
    }

    points.push({
      t: Number(t.toFixed(3)),
      speed: Number(speed.toFixed(2)),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
    });
  }

  // Fill missing speeds from haversine when column absent/zero-ish
  if (speedI < 0 || points.every((p) => p.speed === 0)) {
    for (let i = 1; i < points.length; i += 1) {
      const prev = points[i - 1];
      const cur = points[i];
      if (prev.lat != null && prev.lon != null && cur.lat != null && cur.lon != null) {
        points[i] = {
          ...cur,
          speed: Number(
            haversineSpeedKmh(
              { lat: prev.lat, lon: prev.lon, t: prev.t },
              { lat: cur.lat, lon: cur.lon, t: cur.t },
            ).toFixed(2),
          ),
        };
      }
    }
  }

  return finalizeLogger(
    points,
    "dragy-csv",
    "DRAGY",
    startedAtMs,
    options?.startFinish,
  );
}

/** Humanize CamelCase / PascalCase track tokens from Dragy PNG names. */
export function humanizeTrackToken(token: string): string {
  return token
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse hints from Dragy map PNG names like
 * `ThunderhillRacewayParkWest_20261017161829.png`.
 */
export function parseDlapPngHints(pngNames: string[]): {
  trackNameHint?: string;
  sessionDateHint?: string;
} {
  for (const name of pngNames) {
    const base = name.replace(/^.*\//, "").replace(/\.png$/i, "");
    const match = base.match(/^(.*)_(\d{8})(\d{6})?$/);
    if (!match) continue;
    const trackNameHint = humanizeTrackToken(match[1]);
    const y = match[2].slice(0, 4);
    const m = match[2].slice(4, 6);
    const d = match[2].slice(6, 8);
    const sessionDateHint = `${y}-${m}-${d}`;
    return { trackNameHint, sessionDateHint };
  }
  return {};
}

/**
 * List filenames from a ZIP (central directory) without decompressing payloads.
 * Enough to find Dragy .png map tiles and .group blobs inside .dlap.
 */
export function listZipFilenames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  // End of central directory signature PK\x05\x06
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
    if (bytes.length - i > 65557) break;
  }
  if (eocd < 0) {
    // Fallback: scan local file headers PK\x03\x04
    for (let i = 0; i + 30 < bytes.length; i += 1) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x03 &&
        bytes[i + 3] === 0x04
      ) {
        const nameLen = bytes[i + 26] | (bytes[i + 27] << 8);
        const extraLen = bytes[i + 28] | (bytes[i + 29] << 8);
        const compSize =
          bytes[i + 18] |
          (bytes[i + 19] << 8) |
          (bytes[i + 20] << 16) |
          (bytes[i + 21] << 24);
        if (nameLen > 0 && i + 30 + nameLen <= bytes.length) {
          const name = new TextDecoder().decode(
            bytes.subarray(i + 30, i + 30 + nameLen),
          );
          names.push(name);
        }
        i += 30 + nameLen + extraLen + Math.max(0, compSize) - 1;
      }
    }
    return names;
  }

  const cdOffset =
    bytes[eocd + 16] |
    (bytes[eocd + 17] << 8) |
    (bytes[eocd + 18] << 16) |
    (bytes[eocd + 19] << 24);
  const entries = bytes[eocd + 10] | (bytes[eocd + 11] << 8);
  let pos = cdOffset;
  for (let e = 0; e < entries && pos + 46 <= bytes.length; e += 1) {
    if (
      bytes[pos] !== 0x50 ||
      bytes[pos + 1] !== 0x4b ||
      bytes[pos + 2] !== 0x01 ||
      bytes[pos + 3] !== 0x02
    ) {
      break;
    }
    const nameLen = bytes[pos + 28] | (bytes[pos + 29] << 8);
    const extraLen = bytes[pos + 30] | (bytes[pos + 31] << 8);
    const commentLen = bytes[pos + 32] | (bytes[pos + 33] << 8);
    const name = new TextDecoder().decode(
      bytes.subarray(pos + 46, pos + 46 + nameLen),
    );
    names.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/**
 * Inspect a Dragy .dlap (zip). Always returns a friendly failure message —
 * the .group blob is encrypted and cannot be parsed.
 */
export function inspectDlap(bytes: Uint8Array): DlapHints {
  if (!isZipBytes(bytes)) {
    return {
      pngNames: [],
      message:
        "This .dlap file is not a readable Dragy archive. In Dragy, export CSV, GPX, or VBO instead, then upload that file to Apex.",
    };
  }
  const names = listZipFilenames(bytes);
  const pngNames = names.filter((n) => /\.png$/i.test(n));
  const hasGroup = names.some((n) => /\.group$/i.test(n));
  const hints = parseDlapPngHints(pngNames);
  const hintBits: string[] = [];
  if (hints.trackNameHint) hintBits.push(`track looks like “${hints.trackNameHint}”`);
  if (hints.sessionDateHint) hintBits.push(`date ${hints.sessionDateHint}`);
  const hintSuffix = hintBits.length ? ` (${hintBits.join(", ")})` : "";

  return {
    ...hints,
    pngNames,
    message:
      `Dragy’s native .dlap format can’t be imported — the lap data is in an encrypted .group blob` +
      (hasGroup ? "" : "") +
      `. Export CSV, GPX, or VBO from Dragy (Share / Export), then upload that file instead` +
      hintSuffix +
      ".",
  };
}

export function rejectDlap(bytes: Uint8Array): never {
  const hints = inspectDlap(bytes);
  throw new Error(hints.message);
}

/** Content + extension sniffing for GPS logger uploads. */
export function detectGpsLoggerFormat(
  filename: string,
  sampleText?: string,
): GpsLoggerFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return "mp4";
  if (lower.endsWith(".dlap")) return "dlap";
  if (lower.endsWith(".vbo")) return "vbo";
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".json")) return "gopro-json";

  const sample = (sampleText ?? "").slice(0, 8000);
  const head = sample.trimStart().slice(0, 200).toLowerCase();

  if (head.startsWith("pk") && lower.endsWith(".dlap")) return "dlap";
  if (/\[column names\]/i.test(sample) && /\[data\]/i.test(sample)) return "vbo";
  if (head.startsWith("<?xml") || head.startsWith("<gpx") || /<trkpt\b/i.test(sample)) {
    return "gpx";
  }
  if (head.startsWith("{") || head.startsWith("[")) return "gopro-json";

  if (lower.endsWith(".csv") || sample.includes(",")) {
    const firstLine = sample.split(/\r?\n/).find((l) => l.trim()) ?? "";
    const header = firstLine.toLowerCase();
    // TrackAddict / RaceRender often have lap + elapsed time columns
    if (
      /\blap\b/.test(header) &&
      (/\belapsed\b/.test(header) ||
        /\btime\b/.test(header) ||
        /\butc\b/.test(header))
    ) {
      // Could still be Dragy if it also has explicit lat/lon without TrackAddict markers
      if (/\btrackaddict\b|\brace.?render\b|\blatacc\b|\blonacc\b/i.test(header)) {
        return "trackaddict-csv";
      }
    }
    if (
      /\bdragy\b/i.test(header) ||
      (/\bheading\b/.test(header) &&
        /\b(lat|latitude)\b/.test(header) &&
        /\b(lon|lng|longitude)\b/.test(header))
    ) {
      return "dragy-csv";
    }
    if (/\b(lat|latitude)\b/.test(header) && /\b(lon|lng|longitude)\b/.test(header)) {
      // Plain lat/lon CSV → treat as Dragy/generic logger when no lap index
      if (!/\blap\b/.test(header)) return "dragy-csv";
      return "gopro-csv";
    }
    if (/\blap\b/.test(header)) return "trackaddict-csv";
    return "gopro-csv";
  }

  return "unknown";
}

export function parseGpxLogger(
  text: string,
  options?: GpsLoggerParseOptions,
): GpsLoggerResult {
  const parsed = parseGoProGpx(text, options);
  return {
    laps: parsed.laps,
    pointCount: parsed.pointCount,
    format: "gpx",
    stream: "GPX",
    startedAtMs: parsed.startedAtMs,
    sessionDate: parsed.sessionDate,
    gpsQuality: buildGpsQuality({
      stream: "GPX",
      sampleCount: parsed.pointCount,
      sourceKind: "logger",
    }),
  };
}

/**
 * Unified entry: auto-detect format and parse (or reject .dlap with hints).
 */
export async function parseGpsLoggerFile(
  file: File | Blob,
  filename: string,
  options?: GpsLoggerParseOptions,
): Promise<GpsLoggerResult> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dlap") || lower.endsWith(".zip")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    if (isZipBytes(buf) || lower.endsWith(".dlap")) {
      rejectDlap(buf);
    }
  }

  // Peek for ZIP masquerading without extension
  const headBuf = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (isZipBytes(headBuf) && !lower.endsWith(".mp4")) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const names = listZipFilenames(buf);
    if (names.some((n) => /\.group$/i.test(n) || /\.dlap$/i.test(n))) {
      rejectDlap(buf);
    }
  }

  const text = await file.text();
  const format = detectGpsLoggerFormat(filename, text);

  if (format === "dlap") {
    rejectDlap(new TextEncoder().encode(text));
  }
  if (format === "vbo") return parseVbo(text, options);
  if (format === "gpx") return parseGpxLogger(text, options);
  if (format === "dragy-csv") return parseDragyCsv(text, options);
  if (format === "gopro-json") {
    const parsed = parseGoProJson(text, options);
    return {
      laps: parsed.laps,
      pointCount: parsed.pointCount,
      format,
      stream: "JSON",
      startedAtMs: parsed.startedAtMs,
      sessionDate: parsed.sessionDate,
      gpsQuality: parsed.gpsQuality,
    };
  }
  if (format === "gopro-csv") {
    const parsed = parseGoProCsvExport(text, options);
    return {
      laps: parsed.laps,
      pointCount: parsed.pointCount,
      format,
      stream: "CSV",
      startedAtMs: parsed.startedAtMs,
      sessionDate: parsed.sessionDate,
      gpsQuality: buildGpsQuality({
        stream: "CSV",
        sampleCount: parsed.pointCount,
        sourceKind: "logger",
      }),
    };
  }
  if (format === "trackaddict-csv") {
    throw new Error("TRACKADDICT_CSV");
  }
  if (format === "mp4") {
    throw new Error("Use the GoPro MP4 path for video files.");
  }
  throw new Error(
    `Unrecognized GPS log (${filename}). Use GoPro MP4, GPX, VBO, Dragy CSV, or TrackAddict CSV. Native Dragy .dlap is not supported — export CSV/GPX/VBO from Dragy.`,
  );
}
