/**
 * Two-way YouTube ↔ track playback sync helpers.
 *
 * Clock (track/map/charts) and video can each lead; feedback loops are
 * suppressed for a short window after programmatic seeks/play/pause, and
 * drift is corrected periodically while the clock owns playback.
 */
import {
  isPlaybackSpeed,
  type PlaybackSpeed,
} from "./playback";
import { lapProgressFromVideoTime } from "./video-sync";

export { lapProgressFromVideoTime };

/** Seek video when |actual − expected| exceeds this (seconds). */
export const DRIFT_THRESHOLD_SEC = 0.25;

/** Ignore player events for this long after we drive the player (ms). */
export const SYNC_SUPPRESS_MS = 350;

/** How often to check drift while playing (ms). */
export const DRIFT_CHECK_INTERVAL_MS = 500;

export type SyncAuthority = "clock" | "video";

export type PlayerSyncEvent =
  | { type: "play" }
  | { type: "pause" }
  | { type: "ended" }
  | { type: "seek"; time: number }
  | { type: "rate"; rate: number }
  | { type: "time"; time: number };

export function needsDriftCorrection(
  expectedVideoTime: number,
  actualVideoTime: number,
  thresholdSec: number = DRIFT_THRESHOLD_SEC,
): boolean {
  if (!Number.isFinite(expectedVideoTime) || !Number.isFinite(actualVideoTime)) {
    return false;
  }
  return Math.abs(actualVideoTime - expectedVideoTime) > thresholdSec;
}

export function nearestPlaybackSpeed(rate: number): PlaybackSpeed {
  if (isPlaybackSpeed(rate)) return rate;
  const candidates = [0.25, 0.5, 1, 2] as const;
  let best: PlaybackSpeed = 1;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - rate);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * Mutable suppress window for programmatic player commands.
 * Call `arm()` right before play/pause/seek/rate we initiate.
 */
export function createSyncSuppress(windowMs: number = SYNC_SUPPRESS_MS) {
  let until = 0;
  return {
    arm(extraMs = 0) {
      until = Math.max(until, performance.now() + windowMs + extraMs);
    },
    active() {
      return performance.now() < until;
    },
  };
}
