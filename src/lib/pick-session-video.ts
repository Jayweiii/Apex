/**
 * Resolve which SessionVideo applies to a lap.
 *
 * Priority:
 * 1. Explicit video id (URL ?v=)
 * 2. Lap-specific row (lapId match)
 * 3. Session-level row (lapId null) — offset applies per lap start
 * 4. null (do not steal another lap's clip)
 */
import type { SessionVideo } from "./types";

export function youtubeVideosOnly(videos: SessionVideo[]): SessionVideo[] {
  return videos.filter((v) => v.provider === "youtube" && v.youtubeId);
}

export function pickSessionVideoForLap(
  videos: SessionVideo[] | null | undefined,
  lapId: string | undefined | null,
  options?: { videoId?: string | null; youtubeOnly?: boolean },
): SessionVideo | null {
  const list =
    options?.youtubeOnly === false
      ? [...(videos ?? [])]
      : youtubeVideosOnly(videos ?? []);
  if (!list.length) return null;

  const wanted = options?.videoId;
  if (wanted) {
    const byId = list.find((v) => v.id === wanted);
    if (byId) return byId;
  }

  if (lapId) {
    const forLap = list.find((v) => v.lapId === lapId);
    if (forLap) return forLap;
  }

  const sessionLevel = list.find((v) => v.lapId == null || v.lapId === "");
  return sessionLevel ?? null;
}

export function videoCoverage(
  videos: SessionVideo[],
  lapIds: string[],
): {
  sessionLevel: SessionVideo | null;
  byLapId: Map<string, SessionVideo>;
  lapsWithVideo: Set<string>;
} {
  const yt = youtubeVideosOnly(videos);
  const sessionLevel =
    yt.find((v) => v.lapId == null || v.lapId === "") ?? null;
  const byLapId = new Map<string, SessionVideo>();
  for (const v of yt) {
    if (v.lapId) byLapId.set(v.lapId, v);
  }
  const lapsWithVideo = new Set<string>();
  for (const id of lapIds) {
    if (byLapId.has(id) || sessionLevel) lapsWithVideo.add(id);
  }
  return { sessionLevel, byLapId, lapsWithVideo };
}

export function parseBulkYouTubeUrls(text: string): string[] {
  const tokens = text
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const bare = /^[A-Za-z0-9_-]{11}$/.test(token) ? token : null;
    const match = token.match(
      /(?:youtu\.be\/|v=|shorts\/|embed\/)([A-Za-z0-9_-]{11})/,
    );
    const id = bare ?? match?.[1] ?? null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
