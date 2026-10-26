import type { DriveLatLon, DrivePoint } from "@/lib/drive/types";

const EARTH_M = 6371000;

export function toLocalMeters(
  origin: DriveLatLon,
  point: DriveLatLon,
): DrivePoint {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    x: toRad(point.lon - origin.lon) * EARTH_M * cos,
    y: toRad(point.lat - origin.lat) * EARTH_M,
  };
}

export function fromLocalMeters(
  origin: DriveLatLon,
  x: number,
  y: number,
): DriveLatLon {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    lat: origin.lat + toDeg(y / EARTH_M),
    lon: origin.lon + toDeg(x / (EARTH_M * cos)),
  };
}

export function polylineToLocal(
  origin: DriveLatLon,
  points: DriveLatLon[],
): DrivePoint[] {
  return points.map((p) => toLocalMeters(origin, p));
}

/** Cumulative distance along a polyline (meters). */
export function pathLength(points: DrivePoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return sum;
}

/** Decimate dense GPS so the ribbon stays light on mobile GPUs. */
export function decimatePolyline(
  points: DrivePoint[],
  minSpacingM = 4,
): DrivePoint[] {
  if (points.length < 3) return points.slice();
  const out: DrivePoint[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) >= minSpacingM) {
      out.push(cur);
    }
  }
  const last = points[points.length - 1]!;
  const tip = out[out.length - 1]!;
  if (Math.hypot(last.x - tip.x, last.y - tip.y) > 0.5) out.push(last);
  return out;
}
