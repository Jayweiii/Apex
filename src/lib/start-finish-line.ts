/**
 * Track start/finish line geometry for lap detection + map editing.
 *
 * Stored on tracks.start_finish as either:
 *   { lat, lon, headingDeg? }           — point + optional travel heading
 *   { a: {lat,lon}, b: {lat,lon} }      — two gate endpoints
 */
import { haversineMeters, type LatLon } from "@/lib/map-match";

export type SfPoint = { lat: number; lon: number };

export type StartFinishLine = {
  /** Gate midpoint (crossing reference). */
  lat: number;
  lon: number;
  /** Travel heading through the gate in degrees (0 = north, clockwise). */
  headingDeg?: number;
  /** Optional explicit endpoints (perpendicular to travel). */
  a?: SfPoint;
  b?: SfPoint;
};

const GATE_HALF_WIDTH_M = 12;

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number) {
  return (rad * 180) / Math.PI;
}

/** Midpoint between two lat/lon samples. */
export function midpoint(a: SfPoint, b: SfPoint): SfPoint {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
}

/** Travel heading (deg) from A→B along the track (perpendicular to gate AB). */
export function headingFromGateEndpoints(a: SfPoint, b: SfPoint): number {
  // Gate runs A→B; travel is perpendicular (rotate 90° CCW in east/north).
  const cos = Math.cos(toRad((a.lat + b.lat) / 2)) || 1;
  const east = toRad(b.lon - a.lon) * 6371000 * cos;
  const north = toRad(b.lat - a.lat) * 6371000;
  // Perpendicular travel: (-north, east) → atan2(east_travel, north_travel)
  const travelEast = -north;
  const travelNorth = east;
  return (toDeg(Math.atan2(travelEast, travelNorth)) + 360) % 360;
}

/** Build gate endpoints from midpoint + travel heading. */
export function endpointsFromPointHeading(
  center: SfPoint,
  headingDeg: number,
  halfWidthM = GATE_HALF_WIDTH_M,
): { a: SfPoint; b: SfPoint } {
  const h = toRad(headingDeg);
  // Travel unit in east/north; gate is perpendicular.
  const travelE = Math.sin(h);
  const travelN = Math.cos(h);
  const gateE = -travelN;
  const gateN = travelE;
  const cos = Math.cos(toRad(center.lat)) || 1;
  const dLat = toDeg(halfWidthM / 6371000);
  const dLon = toDeg(halfWidthM / (6371000 * cos));
  return {
    a: {
      lat: center.lat - gateN * dLat,
      lon: center.lon - gateE * dLon,
    },
    b: {
      lat: center.lat + gateN * dLat,
      lon: center.lon + gateE * dLon,
    },
  };
}

/** Normalize any stored jsonb into a StartFinishLine, or null. */
export function parseStartFinishLine(raw: unknown): StartFinishLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const a = parsePoint(row.a);
  const b = parsePoint(row.b);
  if (a && b) {
    const mid = midpoint(a, b);
    const headingDeg = headingFromGateEndpoints(a, b);
    return { lat: mid.lat, lon: mid.lon, headingDeg, a, b };
  }

  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const headingRaw = row.headingDeg ?? row.heading;
  const headingDeg =
    typeof headingRaw === "number" && Number.isFinite(headingRaw)
      ? ((headingRaw % 360) + 360) % 360
      : undefined;
  const line: StartFinishLine = { lat, lon };
  if (headingDeg != null) {
    line.headingDeg = headingDeg;
    const ends = endpointsFromPointHeading(line, headingDeg);
    line.a = ends.a;
    line.b = ends.b;
  }
  return line;
}

function parsePoint(raw: unknown): SfPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** JSONB payload to persist on tracks.start_finish. */
export function serializeStartFinishLine(line: StartFinishLine): Record<string, unknown> {
  const a = line.a;
  const b = line.b;
  if (a && b) {
    return {
      lat: line.lat,
      lon: line.lon,
      headingDeg: line.headingDeg ?? headingFromGateEndpoints(a, b),
      a: { lat: a.lat, lon: a.lon },
      b: { lat: b.lat, lon: b.lon },
    };
  }
  const out: Record<string, unknown> = { lat: line.lat, lon: line.lon };
  if (line.headingDeg != null && Number.isFinite(line.headingDeg)) {
    out.headingDeg = line.headingDeg;
  }
  return out;
}

/** Crossing point only (for splitLapsByStartFinish). */
export function startFinishCrossingPoint(
  line: StartFinishLine | null | undefined,
): { lat: number; lon: number } | null {
  if (!line) return null;
  if (Number.isFinite(line.lat) && Number.isFinite(line.lon)) {
    return { lat: line.lat, lon: line.lon };
  }
  return null;
}

/**
 * Move one endpoint; keep the other fixed. Updates midpoint + heading.
 */
export function moveStartFinishEndpoint(
  line: StartFinishLine,
  which: "a" | "b",
  next: SfPoint,
): StartFinishLine {
  const ends =
    line.a && line.b
      ? { a: { ...line.a }, b: { ...line.b } }
      : endpointsFromPointHeading(
          { lat: line.lat, lon: line.lon },
          line.headingDeg ?? 0,
        );
  ends[which] = { lat: next.lat, lon: next.lon };
  const mid = midpoint(ends.a, ends.b);
  return {
    lat: mid.lat,
    lon: mid.lon,
    headingDeg: headingFromGateEndpoints(ends.a, ends.b),
    a: ends.a,
    b: ends.b,
  };
}

/** Ensure line has explicit endpoints for map rendering. */
export function ensureStartFinishEndpoints(
  line: StartFinishLine,
  halfWidthM = GATE_HALF_WIDTH_M,
): StartFinishLine {
  if (line.a && line.b) return line;
  const heading = line.headingDeg ?? 0;
  const ends = endpointsFromPointHeading(line, heading, halfWidthM);
  return { ...line, headingDeg: heading, a: ends.a, b: ends.b };
}

/** Distance between two SF lines (meters) — for tests / change detection. */
export function startFinishDeltaMeters(
  a: StartFinishLine | null | undefined,
  b: StartFinishLine | null | undefined,
): number | null {
  if (!a || !b) return null;
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}

/** Local east/north meters relative to origin (shared with lap split). */
function toLocalMeters(origin: SfPoint, point: SfPoint) {
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    x: toRad(point.lon - origin.lon) * 6371000 * cos,
    y: toRad(point.lat - origin.lat) * 6371000,
  };
}

/**
 * Perpendicular distance from a GPS point to the SF gate line (meters).
 * Uses endpoints when present; otherwise an east-west line through the midpoint.
 */
export function distanceToStartFinishLineMeters(
  line: StartFinishLine | null | undefined,
  point: SfPoint | null | undefined,
): number | null {
  if (!line || !point) return null;
  if (
    !Number.isFinite(line.lat) ||
    !Number.isFinite(line.lon) ||
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lon)
  ) {
    return null;
  }
  const origin = { lat: line.lat, lon: line.lon };
  const p = toLocalMeters(origin, point);
  let gateE: number;
  let gateN: number;
  if (line.a && line.b) {
    const a = toLocalMeters(origin, line.a);
    const b = toLocalMeters(origin, line.b);
    gateE = b.x - a.x;
    gateN = b.y - a.y;
  } else {
    const heading = line.headingDeg ?? 0;
    const h = toRad(heading);
    // Travel unit; gate is perpendicular.
    const travelE = Math.sin(h);
    const travelN = Math.cos(h);
    gateE = -travelN;
    gateN = travelE;
  }
  const gateLen = Math.hypot(gateE, gateN);
  if (gateLen < 1e-6) {
    return haversineMeters(line.lat, line.lon, point.lat, point.lon);
  }
  // |cross(gate, p)| / |gate| = perpendicular distance.
  return Math.abs(gateE * p.y - gateN * p.x) / gateLen;
}

/**
 * Point + optional travel heading for lap detection.
 * Prefer this over a bare lat/lon so re-split matches the drawn gate.
 */
export type StartFinishSplitRef = {
  lat: number;
  lon: number;
  headingDeg?: number;
  /** When true, do not snap the gate onto a session centerline. */
  locked?: boolean;
};

/** Crossing ref used by splitLapsByStartFinish (preserves heading). */
export function startFinishSplitRef(
  line: StartFinishLine | null | undefined,
): StartFinishSplitRef | null {
  if (!line) return null;
  if (!Number.isFinite(line.lat) || !Number.isFinite(line.lon)) return null;
  const ref: StartFinishSplitRef = {
    lat: line.lat,
    lon: line.lon,
    locked: true,
  };
  if (line.headingDeg != null && Number.isFinite(line.headingDeg)) {
    ref.headingDeg = line.headingDeg;
  } else if (line.a && line.b) {
    ref.headingDeg = headingFromGateEndpoints(line.a, line.b);
  }
  return ref;
}
