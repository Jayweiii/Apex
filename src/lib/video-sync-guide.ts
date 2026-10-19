import { offsetForLapStart } from "@/lib/video-sync";
import type { SessionVideo, VideoSyncSource } from "@/lib/types";

/** Sources that count as an intentional sync (not just a pasted link). */
const SYNCED_SOURCES: ReadonlySet<VideoSyncSource> = new Set([
  "manual",
  "auto",
  "time_of_day",
]);

/** True when the clip has a real start-line sync, not only an attach. */
export function isVideoSynced(
  video: Pick<SessionVideo, "syncSource"> | null | undefined,
): boolean {
  if (!video) return false;
  return SYNCED_SOURCES.has(video.syncSource);
}

export type SyncBadge = {
  label: "Synced" | "Not synced";
  synced: boolean;
};

export function syncBadgeForVideo(
  video: Pick<SessionVideo, "syncSource"> | null | undefined,
): SyncBadge {
  const synced = isVideoSynced(video);
  return { label: synced ? "Synced" : "Not synced", synced };
}

/**
 * Live human readout of how the clip sits relative to lap start.
 * Uses video time at lap start: offsetSec + lapStartOffsetSec (rate = 1).
 */
export function formatOffsetReadout(
  offsetSec: number,
  lapStartOffsetSec = 0,
): string {
  const videoAtLapStart = offsetSec + lapStartOffsetSec;
  if (!Number.isFinite(videoAtLapStart)) return "Offset unknown";
  if (Math.abs(videoAtLapStart) < 0.05) {
    return "Video starts at the lap start";
  }
  if (videoAtLapStart > 0) {
    return `Video starts ${videoAtLapStart.toFixed(1)}s before the lap`;
  }
  return `Video starts ${Math.abs(videoAtLapStart).toFixed(1)}s after the lap`;
}

/**
 * Guess SF video time from surplus clip length vs lap time, then convert
 * to session offset. Centers the lap in the padding when the clip is longer.
 */
export function guessOffsetFromClipLength(
  durationSec: number | null | undefined,
  lapTimeMs: number,
  lapStartOffsetSec = 0,
): number | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
    return null;
  }
  if (!Number.isFinite(lapTimeMs) || lapTimeMs <= 0) return null;
  const lapSec = lapTimeMs / 1000;
  const surplus = durationSec - lapSec;
  const videoTimeAtSf = surplus > 0 ? surplus / 2 : 0;
  return offsetForLapStart(videoTimeAtSf, lapStartOffsetSec);
}

export type SyncGuideStep = 1 | 2 | 3 | 4;

/** Which stepper step to highlight given current video state. */
export function syncGuideStepForVideo(
  video: SessionVideo | null | undefined,
): SyncGuideStep {
  if (!video?.youtubeId && video?.provider !== "mp4") return 1;
  if (!isVideoSynced(video)) return 2;
  return 3;
}
