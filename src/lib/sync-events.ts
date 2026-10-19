/**
 * Manual video↔GPS sync event helpers.
 *
 * Pair a scrubbed video frame with a scrubbed chart/map moment, or snap the
 * chart cursor to a named telemetry event (lap start / start of straight /
 * first brake).
 */
import type { TelemetryPoint } from "./types";

export type SyncEventKind = "lap_start" | "straight_start" | "first_brake";

export const SYNC_EVENT_LABELS: Record<SyncEventKind, string> = {
  lap_start: "Lap start",
  straight_start: "Start of straight",
  first_brake: "First brake",
};

/**
 * Offset so videoTime aligns with absolute session time
 * (sessionTime = lap.startOffsetSec + lapTime).
 */
export function offsetForSessionMoment(
  videoTime: number,
  sessionTimeSec: number,
): number {
  return videoTime - sessionTimeSec;
}

/** Lap-relative time (sec) of a named event inside one lap's telemetry. */
export function findSyncEventLapTime(
  points: TelemetryPoint[],
  kind: SyncEventKind,
): number | null {
  if (!points.length) return kind === "lap_start" ? 0 : null;
  if (kind === "lap_start") return points[0]?.t ?? 0;

  if (kind === "first_brake") {
    // Prefer longitudinal g when present.
    for (let i = 1; i < points.length; i += 1) {
      const g = points[i].lonG;
      if (g != null && g <= -0.25) return points[i].t;
    }
    // Fallback: first sustained speed drop after a local peak.
    let peak = points[0].speed;
    let peakIdx = 0;
    for (let i = 1; i < Math.min(points.length, points.length); i += 1) {
      if (points[i].speed > peak) {
        peak = points[i].speed;
        peakIdx = i;
      }
      if (i > peakIdx + 2 && peak - points[i].speed >= 15 && peak > 60) {
        return points[i].t;
      }
    }
    return null;
  }

  // start of straight: after first significant deceleration, first stretch
  // where speed is high and rising (or flat near peak) with low |latG|.
  const firstBrake = findSyncEventLapTime(points, "first_brake");
  const startIdx =
    firstBrake == null
      ? 0
      : points.findIndex((p) => p.t >= firstBrake);
  const from = Math.max(0, startIdx);

  for (let i = from; i < points.length - 2; i += 1) {
    const window = points.slice(i, Math.min(points.length, i + 6));
    if (window.length < 3) break;
    const speeds = window.map((p) => p.speed);
    const min = Math.min(...speeds);
    const max = Math.max(...speeds);
    const rising = speeds[speeds.length - 1] - speeds[0] >= 5;
    const fast = min >= 80;
    const lowLat = window.every(
      (p) => p.latG == null || Math.abs(p.latG) < 0.35,
    );
    if (fast && rising && lowLat) return points[i].t;
    // Fallback without g: sustained high speed after a valley.
    if (fast && max - min < 8 && speeds[0] > 100) return points[i].t;
  }
  return null;
}

export function sessionTimeForLapEvent(
  lapStartOffsetSec: number,
  lapTimeSec: number,
): number {
  return lapStartOffsetSec + lapTimeSec;
}
