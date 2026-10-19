/**
 * Side-by-side dual-session video: shared lap-relative progress (0..1)
 * drives both players from each lap's start + video offset/rate.
 */
import type { SessionVideo } from "./types";
import {
  toSyncLaps,
  videoTimeFromLapProgress,
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

/** Video time for a side at shared lap-relative progress. */
export function dualVideoTimeAtProgress(
  side: DualVideoSide,
  progress: number,
): number | null {
  if (!side.video) return null;
  return videoTimeFromLapProgress(side.lap, progress, side.video);
}

/**
 * Advance shared lap progress by wall-clock delta using the shortest lap
 * as the shared timeline (lockstep ends when any lap finishes).
 *
 * Accepts either `(progress, dt, refMs, otherMs)` or `(progress, dt, ...lapMs)`.
 */
export function advanceSharedProgress(
  progress: number,
  deltaSec: number,
  ...lapMs: number[]
): number {
  const positive = lapMs.filter((ms) => Number.isFinite(ms) && ms > 0);
  const sharedMs = Math.max(1, positive.length ? Math.min(...positive) : 1);
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
  return {
    refVideoTime: dualVideoTimeAtProgress(ref, 0),
    otherVideoTime: dualVideoTimeAtProgress(other, 0),
  };
}
