import { enrichTelemetry } from "./gforce";
import type { TelemetryPoint } from "./types";

export type DistSample = TelemetryPoint & { dist: number };

export type ComparedPoint = {
  dist: number;
  refSpeed: number;
  otherSpeed: number;
  refG: number;
  otherG: number;
  refLatG: number;
  otherLatG: number;
  refLonG: number;
  otherLonG: number;
  delta: number;
};

export function hasGps(points: TelemetryPoint[]): boolean {
  return points.some((point) => point.lat != null && point.lon != null);
}

export function defaultLapPair(laps: { id: string; lap_time_ms: number }[]) {
  const sorted = [...laps].sort((a, b) => a.lap_time_ms - b.lap_time_ms);
  return {
    ref: sorted[0]?.id ?? "",
    other: (sorted[1] ?? sorted[0])?.id ?? "",
  };
}

export function compareHref(
  sessionId: string,
  laps: { id: string; lap_time_ms: number }[],
  focusId?: string,
) {
  if (laps.length < 2) return null;
  const pair = defaultLapPair(laps);
  const ref = pair.ref;
  const other = focusId && focusId !== ref ? focusId : pair.other;
  if (!ref || !other || ref === other) return null;
  return `/sessions/${sessionId}/compare?ref=${ref}&other=${other}`;
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

export function withDistance(points: TelemetryPoint[]): DistSample[] {
  if (!points.length) return [];
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

function valueAt(
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

export function compareLaps(
  reference: TelemetryPoint[],
  other: TelemetryPoint[],
  steps = 180,
): ComparedPoint[] {
  const ref = withDistance(enrichTelemetry(reference));
  const alt = withDistance(enrichTelemetry(other));
  if (ref.length < 2 || alt.length < 2) return [];
  const refEnd = ref[ref.length - 1].dist;
  const altEnd = alt[alt.length - 1].dist;
  if (refEnd <= 0 || altEnd <= 0) return [];

  const points: ComparedPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const progress = i / (steps - 1);
    const refDist = progress * refEnd;
    const altDist = progress * altEnd;
    const refTime = valueAt(ref, refDist, "t");
    const otherTime = valueAt(alt, altDist, "t");
    points.push({
      dist: refDist,
      refSpeed: valueAt(ref, refDist, "speed"),
      otherSpeed: valueAt(alt, altDist, "speed"),
      refG: valueAt(ref, refDist, "g"),
      otherG: valueAt(alt, altDist, "g"),
      refLatG: valueAt(ref, refDist, "latG"),
      otherLatG: valueAt(alt, altDist, "latG"),
      refLonG: valueAt(ref, refDist, "lonG"),
      otherLonG: valueAt(alt, altDist, "lonG"),
      delta: otherTime - refTime,
    });
  }
  return points;
}
