/**
 * Full-resolution GPS storage for sessions.source_gps.
 *
 * v1 (legacy): jsonb array of { t, lat, lon, s?, a?, b? } — never write new data
 *   in this form (it was easy to accidentally store downsampled lap stitches).
 * v2: columnar delta-encoded int32 channels, gzip+base64. Channels:
 *   t, lat, lon, s (speed), alt, hdg (heading), a (latG), b (lonG).
 *
 * Never downsample before encode — lap telemetry may be coarse; source_gps must
 * keep native rate (GoPro GPS5/GPS9 ~10–18 Hz after dedupe, CSV at native Hz).
 */
import { gunzipSync, gzipSync } from "fflate";
import type { TelemetryPoint } from "@/lib/types";

/** Legacy per-point shape (read-only compatibility). */
export type CompactGpsPoint = {
  t: number;
  lat: number;
  lon: number;
  s?: number;
  a?: number;
  b?: number;
  alt?: number;
  hdg?: number;
};

export const SOURCE_GPS_VERSION = 2 as const;
export const SOURCE_GPS_ENCODING = "col-d32-gz-b64" as const;

/** Soft cap for inline jsonb; larger payloads should use Storage (see migration). */
export const SOURCE_GPS_INLINE_MAX_BYTES = 1_000_000;

export type SourceGpsChannelId =
  | "t"
  | "lat"
  | "lon"
  | "s"
  | "alt"
  | "hdg"
  | "a"
  | "b";

const CHANNEL_SCALES: Record<SourceGpsChannelId, number> = {
  t: 1000,
  lat: 1e7,
  lon: 1e7,
  s: 100,
  alt: 100,
  hdg: 100,
  a: 1000,
  b: 1000,
};

export type SourceGpsV2 = {
  v: typeof SOURCE_GPS_VERSION;
  enc: typeof SOURCE_GPS_ENCODING;
  n: number;
  /** Present channels in payload order. */
  ch: SourceGpsChannelId[];
  /** Parallel scales (ints per unit). */
  scale: number[];
  /** gzip(concat Int32LE delta columns) as base64. */
  data: string;
};

export type SourceGpsStored = SourceGpsV2 | CompactGpsPoint[];

function u8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToU8(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function deltaEncode(values: number[], scale: number): Int32Array {
  const out = new Int32Array(values.length);
  let prev = 0;
  for (let i = 0; i < values.length; i += 1) {
    const scaled = Math.round(values[i]! * scale);
    out[i] = scaled - prev;
    prev = scaled;
  }
  return out;
}

function deltaDecode(deltas: Int32Array, scale: number): number[] {
  const out = new Array<number>(deltas.length);
  let prev = 0;
  for (let i = 0; i < deltas.length; i += 1) {
    prev += deltas[i]!;
    out[i] = prev / scale;
  }
  return out;
}

function int32ToBytes(arr: Int32Array): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

function bytesToInt32(bytes: Uint8Array, offset: number, count: number): Int32Array {
  const slice = bytes.subarray(offset, offset + count * 4);
  // Copy to aligned buffer — subarray may be offset within a larger ArrayBuffer.
  const copy = new Uint8Array(slice.byteLength);
  copy.set(slice);
  return new Int32Array(copy.buffer);
}

function channelValues(
  points: TelemetryPoint[],
  id: SourceGpsChannelId,
): number[] | null {
  const values: number[] = [];
  for (const p of points) {
    let v: number | undefined;
    switch (id) {
      case "t":
        v = p.t;
        break;
      case "lat":
        v = p.lat;
        break;
      case "lon":
        v = p.lon;
        break;
      case "s":
        v = p.speed;
        break;
      case "alt":
        v = p.alt;
        break;
      case "hdg":
        v = p.heading;
        break;
      case "a":
        v = p.latG;
        break;
      case "b":
        v = p.lonG;
        break;
    }
    if (v != null && Number.isFinite(v)) {
      values.push(v);
    } else if (id === "t" || id === "lat" || id === "lon") {
      return null;
    } else {
      values.push(Number.NaN);
    }
  }
  if (id === "t" || id === "lat" || id === "lon") return values;
  if (id === "s") {
    // Speed is required on TelemetryPoint; always store.
    return values.map((v) => (Number.isFinite(v) ? v : 0));
  }
  // Optional channels: omit if fewer than 5% finite samples.
  const finite = values.filter((v) => Number.isFinite(v)).length;
  if (finite < Math.max(1, Math.floor(points.length * 0.05))) return null;
  // Fill gaps by carrying forward last finite (or 0).
  let last = 0;
  return values.map((v) => {
    if (Number.isFinite(v)) {
      last = v;
      return v;
    }
    return last;
  });
}

/**
 * Encode full-res GPS to compact v2 jsonb. Does not downsample.
 * Returns null when there are no usable lat/lon samples.
 */
export function compactSourceGps(
  points: TelemetryPoint[],
): SourceGpsV2 | null {
  const usable = points.filter(
    (p) =>
      p.lat != null &&
      p.lon != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Number.isFinite(p.t),
  );
  if (!usable.length) return null;

  const channelOrder: SourceGpsChannelId[] = [
    "t",
    "lat",
    "lon",
    "s",
    "alt",
    "hdg",
    "a",
    "b",
  ];
  const ch: SourceGpsChannelId[] = [];
  const scale: number[] = [];
  const parts: Uint8Array[] = [];

  for (const id of channelOrder) {
    const values = channelValues(usable, id);
    if (!values) continue;
    const sc = CHANNEL_SCALES[id];
    ch.push(id);
    scale.push(sc);
    parts.push(int32ToBytes(deltaEncode(values, sc)));
  }

  let total = 0;
  for (const part of parts) total += part.length;
  const raw = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    raw.set(part, offset);
    offset += part.length;
  }

  const gz = gzipSync(raw, { level: 6 });
  return {
    v: SOURCE_GPS_VERSION,
    enc: SOURCE_GPS_ENCODING,
    n: usable.length,
    ch,
    scale,
    data: u8ToBase64(gz),
  };
}

function expandV2(blob: SourceGpsV2): TelemetryPoint[] {
  if (blob.enc !== SOURCE_GPS_ENCODING || blob.n < 1) return [];
  if (!Array.isArray(blob.ch) || blob.ch.length !== blob.scale?.length) return [];

  const gz = base64ToU8(blob.data);
  const raw = gunzipSync(gz);
  const expected = blob.n * 4 * blob.ch.length;
  if (raw.byteLength < expected) return [];

  const columns = new Map<SourceGpsChannelId, number[]>();
  let offset = 0;
  for (let i = 0; i < blob.ch.length; i += 1) {
    const id = blob.ch[i] as SourceGpsChannelId;
    const sc = Number(blob.scale[i]);
    if (!Number.isFinite(sc) || sc === 0) return [];
    const deltas = bytesToInt32(raw, offset, blob.n);
    offset += blob.n * 4;
    columns.set(id, deltaDecode(deltas, sc));
  }

  const t = columns.get("t");
  const lat = columns.get("lat");
  const lon = columns.get("lon");
  if (!t || !lat || !lon) return [];

  const speed = columns.get("s");
  const alt = columns.get("alt");
  const hdg = columns.get("hdg");
  const a = columns.get("a");
  const b = columns.get("b");

  const out: TelemetryPoint[] = [];
  for (let i = 0; i < blob.n; i += 1) {
    const point: TelemetryPoint = {
      t: t[i]!,
      lat: lat[i]!,
      lon: lon[i]!,
      speed: speed?.[i] ?? 0,
    };
    if (alt) point.alt = alt[i];
    if (hdg) point.heading = hdg[i];
    if (a) point.latG = a[i];
    if (b) point.lonG = b[i];
    out.push(point);
  }
  return out;
}

function expandV1(raw: CompactGpsPoint[]): TelemetryPoint[] {
  const out: TelemetryPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as CompactGpsPoint;
    const t = Number(row.t);
    const lat = Number(row.lat);
    const lon = Number(row.lon);
    if (![t, lat, lon].every(Number.isFinite)) continue;
    const point: TelemetryPoint = {
      t,
      speed: Number.isFinite(Number(row.s)) ? Number(row.s) : 0,
      lat,
      lon,
    };
    if (Number.isFinite(Number(row.a))) point.latG = Number(row.a);
    if (Number.isFinite(Number(row.b))) point.lonG = Number(row.b);
    if (Number.isFinite(Number(row.alt))) point.alt = Number(row.alt);
    if (Number.isFinite(Number(row.hdg))) point.heading = Number(row.hdg);
    out.push(point);
  }
  return out;
}

/** Decode v2 or legacy v1 array into telemetry points. */
export function expandSourceGps(raw: unknown): TelemetryPoint[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return expandV1(raw as CompactGpsPoint[]);
  if (typeof raw !== "object") return [];
  const row = raw as Record<string, unknown>;
  if (row.v === 2 || row.enc === SOURCE_GPS_ENCODING) {
    try {
      return expandV2(row as unknown as SourceGpsV2);
    } catch {
      return [];
    }
  }
  return [];
}

/** Point count without full decode (v2.n or array length). */
export function sourceGpsPointCount(raw: unknown): number {
  if (raw == null) return 0;
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === "object" && raw !== null && "n" in raw) {
    const n = Number((raw as { n: unknown }).n);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Approximate serialized size of a compact blob. */
export function sourceGpsPayloadBytes(blob: SourceGpsStored | null): number {
  if (blob == null) return 0;
  return JSON.stringify(blob).length;
}

/** True when inline jsonb would exceed the soft cap (use Storage). */
export function sourceGpsNeedsExternalStorage(
  blob: SourceGpsStored | null,
): boolean {
  return sourceGpsPayloadBytes(blob) > SOURCE_GPS_INLINE_MAX_BYTES;
}
