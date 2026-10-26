import { toLocalMeters } from "@/lib/drive/coords";
import type { DriveLatLon, DrivePoint, DriveStartFinish } from "@/lib/drive/types";

export type SfGate = {
  mid: DrivePoint;
  /** Unit vector along the gate (perpendicular to travel). */
  gateX: number;
  gateY: number;
  /** Travel heading through gate (rad). */
  travelHeading: number;
  halfWidthM: number;
};

export function buildSfGate(
  origin: DriveLatLon,
  sf: DriveStartFinish,
  halfWidthM = 14,
): SfGate {
  const mid = toLocalMeters(origin, { lat: sf.lat, lon: sf.lon });
  let travelHeading =
    typeof sf.headingDeg === "number" && Number.isFinite(sf.headingDeg)
      ? (sf.headingDeg * Math.PI) / 180
      : 0;

  if (sf.a && sf.b) {
    const a = toLocalMeters(origin, sf.a);
    const b = toLocalMeters(origin, sf.b);
    const gx = b.x - a.x;
    const gy = b.y - a.y;
    const glen = Math.hypot(gx, gy) || 1;
    // Gate A→B; travel is perpendicular (rotate 90° CCW).
    const travelX = -gy / glen;
    const travelY = gx / glen;
    if (typeof sf.headingDeg !== "number") {
      travelHeading = Math.atan2(travelX, travelY);
    }
    const gateX = gx / glen;
    const gateY = gy / glen;
    return {
      mid: toLocalMeters(origin, {
        lat: (sf.a.lat + sf.b.lat) / 2,
        lon: (sf.a.lon + sf.b.lon) / 2,
      }),
      gateX,
      gateY,
      travelHeading,
      halfWidthM: Math.max(halfWidthM, glen / 2 + 2),
    };
  }

  const gateX = -Math.cos(travelHeading);
  const gateY = Math.sin(travelHeading);
  return { mid, gateX, gateY, travelHeading, halfWidthM };
}

function gateSide(gate: SfGate, x: number, y: number): number {
  const dx = x - gate.mid.x;
  const dy = y - gate.mid.y;
  return gate.gateX * dy - gate.gateY * dx;
}

function alongGate(gate: SfGate, x: number, y: number): number {
  const dx = x - gate.mid.x;
  const dy = y - gate.mid.y;
  return gate.gateX * dx + gate.gateY * dy;
}

/**
 * Detect a forward SF crossing between previous and current positions.
 * Returns true once per pass.
 */
export function crossedStartFinish(
  gate: SfGate,
  prev: DrivePoint,
  next: DrivePoint,
): boolean {
  const side0 = gateSide(gate, prev.x, prev.y);
  const side1 = gateSide(gate, next.x, next.y);
  if (side0 >= 0 || side1 < 0) return false; // need + → − or − → + depending on travel
  // Require crossing from approach side (negative) to departure (positive)
  // relative to travel: side = cross(gate, pos); travel is perp to gate.
  // With gateDir from heading, approach is side>0 then side<0 for one orientation.
  // Use travel dot displacement to require forward motion.
  const dispX = next.x - prev.x;
  const dispY = next.y - prev.y;
  const travelX = Math.sin(gate.travelHeading);
  const travelY = Math.cos(gate.travelHeading);
  if (dispX * travelX + dispY * travelY <= 0) return false;

  // Interpolate crossing point; must be within gate width.
  const t = side0 / (side0 - side1 || 1e-9);
  const cx = prev.x + (next.x - prev.x) * t;
  const cy = prev.y + (next.y - prev.y) * t;
  if (Math.abs(alongGate(gate, cx, cy)) > gate.halfWidthM) return false;
  // Accept either sign flip as long as forward through gate.
  return side0 * side1 <= 0 && Math.abs(side0) + Math.abs(side1) > 0.01;
}

/** More reliable: sign change across gate plane + forward travel + within width. */
export function crossedStartFinishRobust(
  gate: SfGate,
  prev: DrivePoint,
  next: DrivePoint,
): boolean {
  const s0 = gateSide(gate, prev.x, prev.y);
  const s1 = gateSide(gate, next.x, next.y);
  if (s0 === 0 || s1 === 0) return false;
  if (s0 * s1 > 0) return false;

  const travelX = Math.sin(gate.travelHeading);
  const travelY = Math.cos(gate.travelHeading);
  const dispX = next.x - prev.x;
  const dispY = next.y - prev.y;
  // Require clear forward motion through the gate (rejects reverse / re-cross).
  if (dispX * travelX + dispY * travelY < 0.35) return false;

  const t = s0 / (s0 - s1);
  const cx = prev.x + dispX * t;
  const cy = prev.y + dispY * t;
  return Math.abs(alongGate(gate, cx, cy)) <= gate.halfWidthM;
}

/**
 * Fraction of the lap covered along the ribbon since `startAlong`, wrapping
 * at `trackLengthM`. Used to arm SF finish only after most of a lap.
 */
export function lapCoverFraction(
  alongM: number,
  startAlongM: number,
  trackLengthM: number,
): number {
  const len = Math.max(1, trackLengthM);
  let delta = alongM - startAlongM;
  while (delta < 0) delta += len;
  while (delta >= len) delta -= len;
  return Math.max(0, Math.min(1, delta / len));
}

/** Minimum ribbon coverage before an SF crossing can count as a lap finish. */
export const LAP_FINISH_COVER_FRAC = 0.72;
