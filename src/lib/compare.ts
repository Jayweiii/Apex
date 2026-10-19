import { enrichTelemetry } from "./gforce";
import { lapsForDefaultCompare } from "./lap-quality";
import type { TelemetryPoint } from "./types";

export type DistSample = TelemetryPoint & { dist: number };

export type ComparedPoint = {
  /** Meters from lap start along the shared distance axis (snapped trackDist when present). */
  dist: number;
  refSpeed: number;
  otherSpeed: number;
  refG: number;
  otherG: number;
  refLatG: number;
  otherLatG: number;
  refLonG: number;
  otherLonG: number;
  /**
   * Elapsed-time gap at this distance: other.t(d) − ref.t(d) in seconds.
   * Positive means the compared lap is behind at this point on track.
   */
  delta: number;
  /** True when both laps contributed snapped trackDist for this series. */
  snapped?: boolean;
};

/** Up to 4 distinct colors for multi-lap compare (ref first). */
export const COMPARE_COLORS = [
  "#f97316", // orange — reference
  "#38bdf8", // sky
  "#a3e635", // lime
  "#e879f9", // fuchsia
] as const;

export const MAX_COMPARE_LAPS = 4;

/** Flat multi-lap series for Recharts (`speed0` = ref, `delta1` = other[0]−ref, …). */
export type MultiComparedPoint = {
  dist: number;
  snapped?: boolean;
  [key: string]: number | boolean | undefined;
};

export function hasGps(points: TelemetryPoint[]): boolean {
  return points.some((point) => point.lat != null && point.lon != null);
}

export function defaultLapPair(
  laps: { id: string; lap_time_ms: number; excluded?: boolean | null }[],
) {
  const pool = lapsForDefaultCompare(laps);
  const sorted = [...pool].sort((a, b) => a.lap_time_ms - b.lap_time_ms);
  return {
    ref: sorted[0]?.id ?? "",
    other: (sorted[1] ?? sorted[0])?.id ?? "",
  };
}

/** Fastest up to `count` unique lap ids (for seeding a multi-lap compare). */
export function defaultLapIds(
  laps: { id: string; lap_time_ms: number; excluded?: boolean | null }[],
  count = 2,
): string[] {
  const pool = lapsForDefaultCompare(laps);
  const sorted = [...pool].sort((a, b) => a.lap_time_ms - b.lap_time_ms);
  const ids: string[] = [];
  for (const lap of sorted) {
    if (ids.includes(lap.id)) continue;
    ids.push(lap.id);
    if (ids.length >= count) break;
  }
  return ids;
}

export type CompareSlotParam = {
  sessionId: string;
  lapId: string;
};

/**
 * Parse `laps=session:lap,session:lap` query (plus legacy `ref`/`other`/`otherSession`).
 * First slot is the reference when `ref` is omitted.
 */
export function parseCompareSlots(query: {
  ref?: string;
  other?: string;
  otherSession?: string;
  laps?: string;
  baseSessionId: string;
}): CompareSlotParam[] {
  const slots: CompareSlotParam[] = [];
  const seen = new Set<string>();
  const push = (sessionId: string, lapId: string) => {
    if (!sessionId || !lapId) return;
    const key = `${sessionId}:${lapId}`;
    if (seen.has(key)) return;
    if (slots.length >= MAX_COMPARE_LAPS) return;
    seen.add(key);
    slots.push({ sessionId, lapId });
  };

  if (query.laps) {
    for (const part of query.laps.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(":");
      if (colon > 0) {
        push(trimmed.slice(0, colon), trimmed.slice(colon + 1));
      } else {
        push(query.baseSessionId, trimmed);
      }
    }
  }

  if (query.ref) {
    // Ensure ref is first when present.
    const existing = slots.findIndex(
      (s) => s.lapId === query.ref && s.sessionId === query.baseSessionId,
    );
    if (existing > 0) {
      const [slot] = slots.splice(existing, 1);
      slots.unshift(slot);
    } else if (existing < 0) {
      slots.unshift({ sessionId: query.baseSessionId, lapId: query.ref });
      while (slots.length > MAX_COMPARE_LAPS) slots.pop();
    }
  }

  if (query.other) {
    push(query.otherSession || query.baseSessionId, query.other);
  }

  return slots.slice(0, MAX_COMPARE_LAPS);
}

export function serializeCompareSlots(
  slots: CompareSlotParam[],
  refLapId?: string,
): string {
  if (!slots.length) return "";
  const params = new URLSearchParams();
  const ref = refLapId ?? slots[0]?.lapId;
  if (ref) params.set("ref", ref);
  params.set(
    "laps",
    slots.map((s) => `${s.sessionId}:${s.lapId}`).join(","),
  );
  // Legacy pair for older clients when exactly 2 slots.
  if (slots.length === 2) {
    params.set("other", slots[1].lapId);
    if (slots[1].sessionId !== slots[0].sessionId) {
      params.set("otherSession", slots[1].sessionId);
    }
  }
  return params.toString();
}

export function compareHref(
  sessionId: string,
  laps: { id: string; lap_time_ms: number; excluded?: boolean | null }[],
  focusId?: string,
  otherSessionId?: string,
) {
  if (!laps.length) return null;
  const pair = defaultLapPair(laps);
  const ref =
    focusId && laps.some((lap) => lap.id === focusId) ? focusId : pair.ref;
  if (!ref) return null;

  const params = new URLSearchParams({ ref });
  if (otherSessionId) params.set("otherSession", otherSessionId);

  let other: string | undefined;
  if (otherSessionId) {
    // Cross-session: focusId is the other lap when provided as 3rd arg historically
    // only when otherSession is also set via 4th arg.
    other = focusId && focusId !== ref ? focusId : undefined;
  } else if (focusId && focusId !== ref) {
    other = focusId;
  } else if (pair.other && pair.other !== ref) {
    other = pair.other;
  }

  if (other) params.set("other", other);
  // Also emit multi-lap form for forward compatibility.
  const slots: CompareSlotParam[] = [{ sessionId, lapId: ref }];
  if (other) {
    slots.push({
      sessionId: otherSessionId || sessionId,
      lapId: other,
    });
  }
  params.set(
    "laps",
    slots.map((s) => `${s.sessionId}:${s.lapId}`).join(","),
  );
  return `/sessions/${sessionId}/compare?${params.toString()}`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function usesTrackDistance(points: TelemetryPoint[]): boolean {
  return points.some((point) => point.trackDist != null);
}

/**
 * Build a distance axis from lap start (meters).
 * Prefers map-matched trackDist (distance along centerline from SF).
 * Falls back to haversine between GPS samples, then speed×dt.
 */
export function withDistance(points: TelemetryPoint[]): DistSample[] {
  if (!points.length) return [];

  if (usesTrackDistance(points)) {
    const base = points[0].trackDist ?? 0;
    return points.map((point) => ({
      ...point,
      dist: Math.max(0, (point.trackDist ?? base) - base),
    }));
  }

  const out: DistSample[] = [{ ...points[0], dist: 0 }];
  let dist = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const dt = Math.max(0, next.t - prev.t);
    let step = 0;
    if (prev.lat != null && prev.lon != null && next.lat != null && next.lon != null) {
      step = haversine(prev.lat, prev.lon, next.lat, next.lon);
    } else {
      const metersPerSecond = ((prev.speed + next.speed) / 2) * (1000 / 3600);
      step = metersPerSecond * dt;
    }
    dist += step;
    out.push({ ...next, dist });
  }
  return out;
}

function readValue(sample: DistSample | undefined, key: "t" | "speed" | "latG" | "lonG" | "g") {
  const value = sample?.[key];
  return typeof value === "number" ? value : 0;
}

/** Linear interpolate a telemetry channel at an absolute along-track distance. */
export function valueAt(
  samples: DistSample[],
  dist: number,
  key: "t" | "speed" | "latG" | "lonG" | "g",
) {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return 0;
  if (dist <= first.dist) return readValue(first, key);
  if (dist >= last.dist) return readValue(last, key);
  let hi = 1;
  while (hi < samples.length && samples[hi].dist < dist) hi += 1;
  const right = samples[hi] ?? last;
  const left = samples[hi - 1] ?? first;
  const span = right.dist - left.dist;
  const mix = span === 0 ? 0 : (dist - left.dist) / span;
  return readValue(left, key) + (readValue(right, key) - readValue(left, key)) * mix;
}

/**
 * Compare two laps by aligning on identical distance from the start/finish.
 *
 * When both laps have map-matched `trackDist`, distance is meters along the
 * shared centerline. Otherwise distance is cumulative raw GPS (haversine) or
 * speed×dt. At each distance d on the reference axis:
 *   delta(d) = t_other(d) − t_ref(d)  (seconds)
 */
export function compareLaps(
  reference: TelemetryPoint[],
  other: TelemetryPoint[],
  steps = 180,
): ComparedPoint[] {
  const snapped =
    usesTrackDistance(reference) && usesTrackDistance(other);
  const ref = withDistance(enrichTelemetry(reference));
  const alt = withDistance(enrichTelemetry(other));
  if (ref.length < 2 || alt.length < 2) return [];
  const refEnd = ref[ref.length - 1].dist;
  const altEnd = alt[alt.length - 1].dist;
  if (refEnd <= 0 || altEnd <= 0) return [];

  // Shared physical axis: meters from SF along the reference lap.
  // Look up the other lap at the same absolute distance (not % of its own length).
  const axisEnd = snapped ? Math.min(refEnd, altEnd) : refEnd;

  const points: ComparedPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const progress = i / (steps - 1);
    const dist = progress * axisEnd;
    const refTime = valueAt(ref, dist, "t");
    const otherTime = valueAt(alt, dist, "t");
    points.push({
      dist,
      refSpeed: valueAt(ref, dist, "speed"),
      otherSpeed: valueAt(alt, dist, "speed"),
      refG: valueAt(ref, dist, "g"),
      otherG: valueAt(alt, dist, "g"),
      refLatG: valueAt(ref, dist, "latG"),
      otherLatG: valueAt(alt, dist, "latG"),
      refLonG: valueAt(ref, dist, "lonG"),
      otherLonG: valueAt(alt, dist, "lonG"),
      delta: otherTime - refTime,
      snapped,
    });
  }
  return points;
}

/**
 * Compare 2–4 laps against a selected reference.
 * Flat keys: speed0/g0 = reference; speed{i}/g{i}/delta{i} for each other (i≥1).
 * Also mirrors legacy refSpeed/otherSpeed/delta when exactly one other.
 */
export function compareMany(
  reference: TelemetryPoint[],
  others: TelemetryPoint[][],
  steps = 180,
): MultiComparedPoint[] {
  if (!others.length) return [];
  const pairs = others.map((other) => compareLaps(reference, other, steps));
  const n = pairs.reduce((min, series) => Math.min(min, series.length), pairs[0]?.length ?? 0);
  if (n < 2) return [];

  const out: MultiComparedPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const first = pairs[0][i];
    const row: MultiComparedPoint = {
      dist: first.dist,
      snapped: first.snapped,
      speed0: first.refSpeed,
      g0: first.refG,
      latG0: first.refLatG,
      lonG0: first.refLonG,
    };
    pairs.forEach((series, j) => {
      const point = series[i];
      const idx = j + 1;
      row[`speed${idx}`] = point.otherSpeed;
      row[`g${idx}`] = point.otherG;
      row[`latG${idx}`] = point.otherLatG;
      row[`lonG${idx}`] = point.otherLonG;
      row[`delta${idx}`] = point.delta;
    });
    // Legacy aliases for 2-lap tooltips / older charts.
    if (others.length === 1) {
      row.refSpeed = first.refSpeed;
      row.otherSpeed = first.otherSpeed;
      row.refG = first.refG;
      row.otherG = first.otherG;
      row.delta = first.delta;
    }
    out.push(row);
  }
  return out;
}
