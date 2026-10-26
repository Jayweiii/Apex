/**
 * Side-by-side dual-session video: shared elapsed-ms progress (0..1)
 * drives both players from each lap's start + video offset/rate.
 *
 * progress ≡ elapsedMs / sharedCompareDurationMs (max lap). Same wall
 * clock for every side — not % of each lap's own duration — so map/video
 * show the spatial gap at identical elapsed time from lap start.
 */
import { sharedCompareDurationMs } from "./compare";
import type { SessionVideo } from "./types";
import {
  sessionTimeForLapPoint,
  sessionTimeFromVideo,
  toSyncLaps,
  videoTimeFromSession,
  type SyncLap,
} from "./video-sync";

export type DualVideoSide = {
  lap: SyncLap;
  video: SessionVideo | null;
  /** Resolved MP4 object URL / download URL when provider is mp4. */
  mp4Src?: string | null;
  /**
   * True when the session has an MP4 metadata row (with offset) but the
   * media blob is not available in this browser / object storage.
   */
  needsLocalFile?: boolean;
  label: string;
};

export { sharedCompareDurationMs };

export function lapAsSyncLap(lap: {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  start_offset_sec?: number | null;
  telemetry: { t: number; speed: number }[];
}): SyncLap {
  return (
    toSyncLaps([lap])[0] ?? {
      id: lap.id,
      lapNumber: lap.lap_number,
      lapTimeMs: lap.lap_time_ms,
      startOffsetSec: lap.start_offset_sec ?? 0,
      points: lap.telemetry,
    }
  );
}

/** Elapsed seconds on the shared compare clock for progress 0..1. */
export function elapsedSecFromProgress(
  progress: number,
  sharedMs: number,
): number {
  const clock = Math.max(1, sharedMs) / 1000;
  return Math.max(0, Math.min(1, progress)) * clock;
}

/** Clamp elapsed seconds into a single lap's playback window. */
export function lapLocalSecFromElapsed(
  lap: Pick<SyncLap, "lapTimeMs">,
  elapsedSec: number,
): number {
  const lapDur = Math.max(0.001, lap.lapTimeMs / 1000);
  return Math.max(0, Math.min(elapsedSec, lapDur));
}

/**
 * Video time for a side at shared progress on the max-lap clock.
 * Pass `sharedMs` (max lap) so every side seeks the same elapsed ms.
 */
export function dualVideoTimeAtProgress(
  side: DualVideoSide,
  progress: number,
  sharedMs?: number,
): number | null {
  if (!side.video) return null;
  const clockMs = sharedMs ?? sharedCompareDurationMs(side.lap.lapTimeMs);
  const elapsed = elapsedSecFromProgress(progress, clockMs);
  const lapTime = lapLocalSecFromElapsed(side.lap, elapsed);
  return videoTimeFromSession(
    sessionTimeForLapPoint(side.lap, lapTime),
    side.video,
  );
}

/**
 * Shared progress from a side's video clock (elapsed / sharedMs).
 */
export function dualProgressFromVideoTime(
  side: DualVideoSide,
  videoTime: number,
  sharedMs: number,
): number {
  if (!side.video) return 0;
  const sessionTime = sessionTimeFromVideo(videoTime, side.video);
  const elapsed = Math.max(0, sessionTime - side.lap.startOffsetSec);
  const clock = Math.max(1, sharedMs) / 1000;
  return Math.max(0, Math.min(1, elapsed / clock));
}

/**
 * Advance shared lap progress by wall-clock delta using the longest lap
 * as the shared timeline (absolute elapsed ms — cars diverge spatially).
 *
 * Accepts either `(progress, dt, refMs, otherMs)` or `(progress, dt, ...lapMs)`.
 */
export function advanceSharedProgress(
  progress: number,
  deltaSec: number,
  ...lapMs: number[]
): number {
  const sharedMs = sharedCompareDurationMs(...lapMs);
  const next = progress + deltaSec / (sharedMs / 1000);
  return Math.max(0, Math.min(1, next));
}

export function sideHasPlayableVideo(side: DualVideoSide): boolean {
  if (!side.video) return false;
  if (side.video.provider === "youtube") return Boolean(side.video.youtubeId);
  return Boolean(side.mp4Src);
}

/** Session has video metadata (offset etc.) even if media is missing locally. */
export function sideHasVideoMeta(side: DualVideoSide): boolean {
  return Boolean(side.video);
}

/**
 * Align dual compare at lap start: shared progress 0 maps each side through
 * its own offsetSec (already baked into dualVideoTimeAtProgress).
 */
export function dualCompareAlignedAtLapStart(
  ref: DualVideoSide,
  other: DualVideoSide,
): { refVideoTime: number | null; otherVideoTime: number | null } {
  const sharedMs = sharedCompareDurationMs(
    ref.lap.lapTimeMs,
    other.lap.lapTimeMs,
  );
  return {
    refVideoTime: dualVideoTimeAtProgress(ref, 0, sharedMs),
    otherVideoTime: dualVideoTimeAtProgress(other, 0, sharedMs),
  };
}
