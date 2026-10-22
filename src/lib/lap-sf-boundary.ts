/**
 * Start/finish lap-boundary helpers: distance to the SF gate, snap endpoints
 * onto the line so adjacent laps meet with no gap/overlap, and map metadata
 * (crossing point + out/in kind).
 */
import { flagSuspiciousLaps, type LapQualityInput } from "@/lib/lap-quality";
import { haversineMeters, type LatLon } from "@/lib/map-match";
import {
  ensureStartFinishEndpoints,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import type { TelemetryPoint } from "@/lib/types";

export type LapKind = "out" | "in" | "hot";

export type SfCrossingMeta = {
  kind: LapKind;
  crossing: LatLon | null;
};

const DEFAULT_SNAP_M = 40;

function toLocal(origin: LatLon, point: LatLon) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    x: toRad(point.lon - origin.lon) * 6371000 * cos,
    y: toRad(point.lat - origin.lat) * 6371000,
  };
}

function fromLocal(origin: LatLon, local: { x: number; y: number }): LatLon {
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos((origin.lat * Math.PI) / 180) || 1;
  return {
    lat: origin.lat + toDeg(local.y / 6371000),
    lon: origin.lon + toDeg(local.x / (6371000 * cos)),
  };
}

function firstGps(points: TelemetryPoint[]): LatLon | null {
  for (const p of points) {
    if (
      p.lat != null &&
      p.lon != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon)
    ) {
      return { lat: p.lat, lon: p.lon };
    }
  }
  return null;
}

function lastGps(points: TelemetryPoint[]): LatLon | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i]!;
    if (
      p.lat != null &&
      p.lon != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon)
    ) {
      return { lat: p.lat, lon: p.lon };
    }
  }
  return null;
}

export function sfGateEndpoints(
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
): { a: LatLon; b: LatLon; mid: LatLon } | null {
  if (!sf || !Number.isFinite(sf.lat) || !Number.isFinite(sf.lon)) return null;
  const line =
    "a" in sf || "headingDeg" in sf
      ? ensureStartFinishEndpoints(sf as StartFinishLine)
      : ensureStartFinishEndpoints({ lat: sf.lat, lon: sf.lon, headingDeg: 0 });
  if (!line.a || !line.b) return null;
  return { a: line.a, b: line.b, mid: { lat: line.lat, lon: line.lon } };
}

export function distanceToSfLineMeters(
  point: LatLon,
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
): number | null {
  const projected = projectOntoSfLine(point, sf);
  if (!projected) return null;
  return haversineMeters(point.lat, point.lon, projected.lat, projected.lon);
}

export function distanceToSfCenterMeters(
  point: LatLon,
  sf: { lat: number; lon: number } | null | undefined,
): number | null {
  if (!sf || !Number.isFinite(sf.lat) || !Number.isFinite(sf.lon)) return null;
  return haversineMeters(point.lat, point.lon, sf.lat, sf.lon);
}

export function projectOntoSfLine(
  point: LatLon,
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
): LatLon | null {
  const gate = sfGateEndpoints(sf);
  if (!gate) return null;
  const origin = gate.a;
  const p = toLocal(origin, point);
  const b = toLocal(origin, gate.b);
  const len2 = b.x * b.x + b.y * b.y;
  const t =
    len2 <= 1e-12
      ? 0
      : Math.min(1, Math.max(0, (p.x * b.x + p.y * b.y) / len2));
  return fromLocal(origin, { x: b.x * t, y: b.y * t });
}

export function snapTelemetryEndpointToSf(
  points: TelemetryPoint[],
  which: "first" | "last",
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
  maxSnapM = DEFAULT_SNAP_M,
): TelemetryPoint[] {
  if (!points.length || !sf) return points;
  const idx = which === "first" ? 0 : points.length - 1;
  const sample = points[idx]!;
  if (sample.lat == null || sample.lon == null) return points;
  const dist = distanceToSfLineMeters(
    { lat: sample.lat, lon: sample.lon },
    sf,
  );
  if (dist == null || dist > maxSnapM || dist < 0.05) return points;
  const projected = projectOntoSfLine(
    { lat: sample.lat, lon: sample.lon },
    sf,
  );
  if (!projected) return points;
  const next = points.slice();
  next[idx] = { ...sample, lat: projected.lat, lon: projected.lon };
  return next;
}

export function alignLapBoundariesToSf<
  T extends { lap_number: number; telemetry?: TelemetryPoint[] | null },
>(
  laps: T[],
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
  options?: { maxSnapM?: number },
): T[] {
  if (!sf || laps.length < 1) return laps;
  const maxSnapM = options?.maxSnapM ?? DEFAULT_SNAP_M;
  const ordered = [...laps].sort((a, b) => a.lap_number - b.lap_number);

  const byNumber = new Map<number, TelemetryPoint[]>();
  for (const lap of ordered) {
    byNumber.set(lap.lap_number, (lap.telemetry ?? []).slice());
  }

  for (const lap of ordered) {
    let pts = byNumber.get(lap.lap_number) ?? [];
    pts = snapTelemetryEndpointToSf(pts, "first", sf, maxSnapM);
    pts = snapTelemetryEndpointToSf(pts, "last", sf, maxSnapM);
    byNumber.set(lap.lap_number, pts);
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const a = ordered[i]!;
    const b = ordered[i + 1]!;
    const aPts = byNumber.get(a.lap_number) ?? [];
    const bPts = byNumber.get(b.lap_number) ?? [];
    if (!aPts.length || !bPts.length) continue;
    const aLast = aPts[aPts.length - 1]!;
    const bFirst = bPts[0]!;
    if (
      aLast.lat == null ||
      aLast.lon == null ||
      bFirst.lat == null ||
      bFirst.lon == null
    ) {
      continue;
    }
    const gap = haversineMeters(aLast.lat, aLast.lon, bFirst.lat, bFirst.lon);
    const aToSf = distanceToSfLineMeters(
      { lat: aLast.lat, lon: aLast.lon },
      sf,
    );
    const bToSf = distanceToSfLineMeters(
      { lat: bFirst.lat, lon: bFirst.lon },
      sf,
    );
    const nearGate =
      (aToSf != null && aToSf <= maxSnapM) ||
      (bToSf != null && bToSf <= maxSnapM);
    if (!nearGate && gap > 5) continue;

    const mid: LatLon = {
      lat: (aLast.lat + bFirst.lat) / 2,
      lon: (aLast.lon + bFirst.lon) / 2,
    };
    const onLine = projectOntoSfLine(mid, sf) ?? mid;
    aPts[aPts.length - 1] = { ...aLast, lat: onLine.lat, lon: onLine.lon };
    bPts[0] = { ...bFirst, lat: onLine.lat, lon: onLine.lon };
    byNumber.set(a.lap_number, aPts);
    byNumber.set(b.lap_number, bPts);
  }

  return laps.map((lap) => {
    const pts = byNumber.get(lap.lap_number);
    if (!pts) return lap;
    const prev = lap.telemetry ?? [];
    if (pts.length === prev.length && pts.every((p, i) => p === prev[i])) {
      return lap;
    }
    return { ...lap, telemetry: pts };
  });
}

export function lapKindsForSession(
  laps: LapQualityInput[],
): Map<number, LapKind> {
  const ordered = [...laps].sort((a, b) => a.lap_number - b.lap_number);
  const flags = flagSuspiciousLaps(ordered);
  const byId = new Map(flags.map((f) => [f.lapId, f]));
  const out = new Map<number, LapKind>();
  for (const lap of ordered) {
    const flag = byId.get(lap.id);
    if (flag?.reasons.includes("out_lap")) out.set(lap.lap_number, "out");
    else if (flag?.reasons.includes("in_lap")) out.set(lap.lap_number, "in");
    else out.set(lap.lap_number, "hot");
  }
  return out;
}

export function resolveLapSfCrossing(
  points: TelemetryPoint[],
  kind: LapKind,
  sf?: StartFinishLine | { lat: number; lon: number } | null,
): LatLon | null {
  const raw = kind === "out" ? lastGps(points) : firstGps(points);
  if (!raw) return null;
  if (!sf) return raw;
  const dist = distanceToSfLineMeters(raw, sf);
  if (dist != null && dist <= DEFAULT_SNAP_M) {
    return projectOntoSfLine(raw, sf) ?? raw;
  }
  if (kind === "hot") {
    const end = lastGps(points);
    if (end) {
      const endDist = distanceToSfLineMeters(end, sf);
      if (
        endDist != null &&
        (dist == null || endDist + 5 < dist) &&
        endDist <= DEFAULT_SNAP_M
      ) {
        return projectOntoSfLine(end, sf) ?? end;
      }
    }
  }
  return raw;
}

export function lapKindMapLabel(kind: LapKind): string | null {
  if (kind === "out") return "OUT";
  if (kind === "in") return "IN";
  return null;
}

export function snapParsedLapsToSfGate<
  T extends { lapNumber: number; points: TelemetryPoint[] },
>(
  laps: T[],
  sf: StartFinishLine | { lat: number; lon: number } | null | undefined,
  options?: { maxSnapM?: number },
): T[] {
  if (!sf || laps.length < 1) return laps;
  const asStored = laps.map((lap) => ({
    lap_number: lap.lapNumber,
    telemetry: lap.points,
  }));
  const aligned = alignLapBoundariesToSf(asStored, sf, options);
  return laps.map((lap, i) => {
    const nextPts = aligned[i]?.telemetry ?? lap.points;
    if (nextPts === lap.points) return lap;
    return { ...lap, points: nextPts };
  });
}
