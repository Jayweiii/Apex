/**
 * Which laps does a video actually contain?
 *
 * A video can cover one lap, several laps, or a whole session. Its position
 * on the session clock comes from `offsetSec` (videoTime = offset + rate ×
 * sessionTime); its end comes from the player's duration. A lap whose window
 * falls outside [0, duration] is not in the video — the player must not be
 * driven there (seeking past the end made YouTube end / restart in a loop).
 */
import type { SessionVideo } from "./types";
import { videoTimeFromSession } from "./video-sync";

export type CoverageLap = {
  id?: string;
  lapNumber: number;
  startOffsetSec: number;
  lapTimeMs: number;
};

export type LapCoverage = "full" | "partial" | "none" | "unknown";

/** Seconds of slack so sync jitter at a lap edge still counts as covered. */
const EDGE_SLACK_SEC = 1.5;

/** Video-time window [start, end] for a lap under this video's sync. */
export function lapVideoWindow(
  lap: Pick<CoverageLap, "startOffsetSec" | "lapTimeMs">,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
): { start: number; end: number } {
  const start = videoTimeFromSession(lap.startOffsetSec, video);
  const end = videoTimeFromSession(
    lap.startOffsetSec + Math.max(0, lap.lapTimeMs) / 1000,
    video,
  );
  return { start, end };
}

export function lapCoverage(
  lap: Pick<CoverageLap, "startOffsetSec" | "lapTimeMs">,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
  durationSec: number | null | undefined,
): LapCoverage {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    return "unknown";
  }
  const { start, end } = lapVideoWindow(lap, video);
  if (end <= EDGE_SLACK_SEC || start >= durationSec - EDGE_SLACK_SEC) {
    return "none";
  }
  if (start >= -EDGE_SLACK_SEC && end <= durationSec + EDGE_SLACK_SEC) {
    return "full";
  }
  return "partial";
}

/** Lap numbers this video contains (full or partial), in order. */
export function coveredLapNumbers(
  laps: CoverageLap[],
  video: Pick<SessionVideo, "offsetSec" | "rate">,
  durationSec: number | null | undefined,
): number[] {
  return laps
    .filter((lap) => {
      const c = lapCoverage(lap, video, durationSec);
      return c === "full" || c === "partial";
    })
    .map((lap) => lap.lapNumber)
    .sort((a, b) => a - b);
}

/** "lap 3", "laps 3–5", "laps 2, 4" */
export function describeLapNumbers(numbers: number[]): string {
  if (!numbers.length) return "no laps";
  if (numbers.length === 1) return `lap ${numbers[0]}`;
  const contiguous = numbers.every(
    (n, i) => i === 0 || n === numbers[i - 1] + 1,
  );
  return contiguous
    ? `laps ${numbers[0]}–${numbers[numbers.length - 1]}`
    : `laps ${numbers.join(", ")}`;
}

/**
 * Default offset for a fresh (unsynced) video whose first frame is the start
 * of `lap`: videoTime 0 ↔ lap start. Point-match sync fine-tunes it later.
 */
export function offsetForVideoStartingAtLap(
  lap: Pick<CoverageLap, "startOffsetSec">,
): number {
  return -lap.startOffsetSec;
}

/* Per-viewer cache of video durations, so lap lists can show real coverage
 * before a player has loaded. Convenience only — never required. */
const DURATION_KEY = "apex.videoDurations.v1";

function durationKey(video: Pick<SessionVideo, "youtubeId" | "objectKey" | "id">) {
  return video.youtubeId ?? video.objectKey ?? video.id;
}

export function readCachedVideoDuration(
  video: Pick<SessionVideo, "youtubeId" | "objectKey" | "id">,
): number | null {
  try {
    const raw = window.localStorage.getItem(DURATION_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number>;
    const value = map[durationKey(video)];
    return typeof value === "number" && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeCachedVideoDuration(
  video: Pick<SessionVideo, "youtubeId" | "objectKey" | "id">,
  durationSec: number,
): void {
  if (!(durationSec > 0)) return;
  try {
    const raw = window.localStorage.getItem(DURATION_KEY);
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, number>;
    map[durationKey(video)] = durationSec;
    window.localStorage.setItem(DURATION_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable (private mode) — coverage falls back to "unknown"
  }
}
