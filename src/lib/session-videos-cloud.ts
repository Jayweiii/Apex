/**
 * Persist / load session_videos rows (YouTube + MP4) including offsetSec.
 */
import type { SessionVideo, VideoSyncSource } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export type SessionVideoRow = {
  id: string;
  session_id: string;
  user_id?: string;
  provider: string;
  youtube_id?: string | null;
  youtube_url?: string | null;
  object_key?: string | null;
  title?: string | null;
  lap_id?: string | null;
  lap_index?: number | null;
  offset_sec?: number | null;
  rate?: number | null;
  sync_source?: string | null;
  video_started_at?: string | null;
};

export function rowToSessionVideo(row: SessionVideoRow): SessionVideo {
  const started = row.video_started_at
    ? Date.parse(row.video_started_at)
    : NaN;
  return {
    id: row.id,
    provider: row.provider === "youtube" ? "youtube" : "mp4",
    youtubeId: row.youtube_id ?? undefined,
    youtubeUrl: row.youtube_url ?? undefined,
    objectKey: row.object_key ?? undefined,
    title: row.title ?? undefined,
    lapId: row.lap_id ?? null,
    lapIndex: row.lap_index ?? null,
    offsetSec: row.offset_sec ?? 0,
    rate: row.rate ?? 1,
    syncSource: (row.sync_source as VideoSyncSource | null) ?? "unsynced",
    videoStartedAtMs: Number.isFinite(started) ? started : undefined,
  };
}

export function sessionVideoToInsert(
  video: SessionVideo,
  sessionId: string,
  userId: string,
) {
  return {
    id: video.id,
    session_id: sessionId,
    user_id: userId,
    provider: video.provider,
    youtube_id: video.youtubeId ?? null,
    youtube_url: video.youtubeUrl ?? null,
    object_key: video.objectKey ?? null,
    title: video.title ?? null,
    lap_id: video.lapId ?? null,
    lap_index: video.lapIndex ?? null,
    offset_sec: video.offsetSec,
    rate: video.rate ?? 1,
    sync_source: video.syncSource,
    video_started_at: video.videoStartedAtMs
      ? new Date(video.videoStartedAtMs).toISOString()
      : null,
  };
}

export async function fetchSessionVideos(
  client: SupabaseLike,
  sessionId: string,
): Promise<SessionVideo[]> {
  const { data, error } = await client
    .from("session_videos")
    .select(
      "id, session_id, provider, youtube_id, youtube_url, object_key, title, lap_id, lap_index, offset_sec, rate, sync_source, video_started_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as SessionVideoRow[]).map(rowToSessionVideo);
}

export async function upsertSessionVideo(
  client: SupabaseLike,
  sessionId: string,
  userId: string,
  video: SessionVideo,
): Promise<void> {
  const row = sessionVideoToInsert(video, sessionId, userId);
  const { error } = await client.from("session_videos").upsert(row, {
    onConflict: "id",
  });
  if (error) throw new Error(error.message);
}

export async function updateSessionVideoSync(
  client: SupabaseLike,
  video: Pick<
    SessionVideo,
    "id" | "offsetSec" | "rate" | "syncSource" | "videoStartedAtMs" | "lapId"
  >,
): Promise<void> {
  const { error } = await client
    .from("session_videos")
    .update({
      offset_sec: video.offsetSec,
      rate: video.rate ?? 1,
      sync_source: video.syncSource,
      lap_id: video.lapId ?? null,
      video_started_at: video.videoStartedAtMs
        ? new Date(video.videoStartedAtMs).toISOString()
        : null,
    })
    .eq("id", video.id);
  if (error) throw new Error(error.message);
}

export async function deleteSessionVideo(
  client: SupabaseLike,
  videoId: string,
): Promise<void> {
  const { error } = await client
    .from("session_videos")
    .delete()
    .eq("id", videoId);
  if (error) throw new Error(error.message);
}

/**
 * Resolve a playable MP4 src for a video, or signal that the viewer must
 * attach a local file (IDB-only / missing object storage).
 */
export function resolveMp4Playback(video: SessionVideo): {
  src: string | null;
  needsLocalFile: boolean;
} {
  if (video.provider !== "mp4") return { src: null, needsLocalFile: false };
  if (video.objectKey && !video.objectKey.startsWith("local/")) {
    return {
      src: `/api/storage/download?key=${encodeURIComponent(video.objectKey)}`,
      needsLocalFile: false,
    };
  }
  // localKey / idb-only object keys require the blob in this browser.
  if (video.localKey || video.objectKey?.startsWith("local/")) {
    return { src: null, needsLocalFile: true };
  }
  return { src: null, needsLocalFile: true };
}
