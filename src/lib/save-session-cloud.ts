import { assertUserUploadRateLimit } from "@/lib/abuse-limits";
import type { GpsQuality } from "@/lib/gps-quality";
import {
  compactSourceGps,
  type SourceGpsStored,
} from "@/lib/session-reparse";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";

export type CloudSessionMeta = {
  name: string;
  filename: string | null;
  trackId: string;
  car: string;
  carClass: string;
  carTags: string[];
  driver?: string;
  weather?: string;
  tires?: string;
  notes?: string;
  sourceKind: "csv" | "gopro" | "logger";
  gpsQuality?: GpsQuality | null;
  /** Full-res GPS for later re-split (compacted on save — never downsampled). */
  sourcePoints?: TelemetryPoint[] | null;
  sourceGps?: SourceGpsStored | null;
  rawObjectKey?: string | null;
  videoObjectKey?: string | null;
  storageBackend?: string | null;
  startedAtMs?: number;
  sessionDate?: string;
  /** Prefer this id so R2/object keys match the session row. */
  id?: string;
  videos?: SessionVideo[];
  /** private | friends | public — defaults to friends */
  visibility?: SessionVisibility;
};

export type CloudSessionPayload = {
  session: Record<string, unknown>;
  laps: Array<Record<string, unknown>>;
  videos: Array<Record<string, unknown>>;
};

/** Build the rows that will be inserted into Supabase (no network). */
export function buildCloudSessionPayload(
  userId: string,
  laps: ParsedLap[],
  meta: CloudSessionMeta,
): CloudSessionPayload {
  if (!meta.trackId.trim()) throw new Error("Choose a track");
  if (!meta.car.trim()) throw new Error("Enter the car");
  if (!laps.length) throw new Error("No laps to save");

  const sourceGps =
    meta.sourceGps ??
    (meta.sourcePoints?.length ? compactSourceGps(meta.sourcePoints) : null);

  const session: Record<string, unknown> = {
    user_id: userId,
    name: meta.name,
    filename: meta.filename,
    track_id: meta.trackId,
    car: meta.car,
    car_class: meta.carClass,
    car_tags: meta.carTags,
    driver_name: meta.driver?.trim() || null,
    weather: meta.weather?.trim() || null,
    tires: meta.tires?.trim() || null,
    notes: meta.notes?.trim() || null,
    source_kind: meta.sourceKind,
    gps_quality: meta.gpsQuality ?? null,
    source_gps: sourceGps,
    raw_object_key: meta.rawObjectKey ?? null,
    video_object_key: meta.videoObjectKey ?? null,
    storage_backend: meta.storageBackend ?? null,
    started_at: meta.startedAtMs
      ? new Date(meta.startedAtMs).toISOString()
      : null,
    session_date: meta.sessionDate ?? null,
    visibility: normalizeVisibility(meta.visibility ?? DEFAULT_VISIBILITY),
  };
  if (meta.id) session.id = meta.id;

  const lapRows = laps.map((lap) => ({
    // session_id filled after insert
    user_id: userId,
    lap_number: lap.lapNumber,
    lap_time_ms: lap.lapTimeMs,
    telemetry: lap.points,
    start_offset_sec: lap.startOffsetSec ?? null,
    started_at_ms: lap.startedAtMs ?? null,
  }));

  // Onboards are YouTube-only — ignore legacy videoObjectKey as a playable row.
  const videosMeta = (meta.videos ?? []).filter(
    (video) => video.provider === "youtube",
  );

  const videos = videosMeta.map((video) => ({
    id: video.id,
    user_id: userId,
    provider: video.provider,
    youtube_id: video.youtubeId ?? null,
    youtube_url: video.youtubeUrl ?? null,
    object_key: video.objectKey ?? null,
    title: video.title ?? null,
    // lap_id resolved after lap insert when possible
    lap_id: video.lapId ?? null,
    lap_index: video.lapIndex ?? null,
    offset_sec: video.offsetSec,
    rate: video.rate ?? 1,
    sync_source: video.syncSource,
    video_started_at: video.videoStartedAtMs
      ? new Date(video.videoStartedAtMs).toISOString()
      : null,
  }));

  return { session, laps: lapRows, videos };
}

/** Minimal shape used for inserts; accepts the real Supabase browser client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

/**
 * Persist a parsed session + laps (+ optional videos) to Supabase.
 */
export async function saveSessionToCloud(
  client: SupabaseLike,
  laps: ParsedLap[],
  meta: CloudSessionMeta,
): Promise<{ sessionId: string; lapCount: number }> {
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (userError || !user) {
    throw new Error(userError?.message ?? "You need to be signed in");
  }

  await assertUserUploadRateLimit(client, user.id);

  const payload = buildCloudSessionPayload(user.id, laps, meta);

  let sessionInsert = await client
    .from("sessions")
    .insert(payload.session)
    .select("id")
    .single();
  // Drop optional columns gracefully when migrations are not yet applied.
  // Only treat "column missing" as soft — never silently drop source_gps on
  // payload/RLS failures (that left session 1aa2fb88 with NULL source_gps).
  if (
    sessionInsert.error &&
    /column .*source_gps|source_gps.*does not exist|Could not find the .*source_gps/i.test(
      String(sessionInsert.error.message ?? ""),
    )
  ) {
    const { source_gps: _omitSource, ...withoutSource } = payload.session;
    void _omitSource;
    sessionInsert = await client
      .from("sessions")
      .insert(withoutSource)
      .select("id")
      .single();
  }
  if (
    sessionInsert.error &&
    /gps_quality/i.test(String(sessionInsert.error.message ?? ""))
  ) {
    const { gps_quality: _omitGps, ...withoutGps } = payload.session;
    void _omitGps;
    sessionInsert = await client
      .from("sessions")
      .insert(withoutGps)
      .select("id")
      .single();
  }
  // Before visibility migration is applied: only silently drop the column when
  // the chosen visibility is the default (friends). Explicit private/public
  // must fail loudly so the user knows to run the migration.
  if (
    sessionInsert.error &&
    /visibility/i.test(String(sessionInsert.error.message ?? ""))
  ) {
    const chosen = normalizeVisibility(
      (payload.session.visibility as SessionVisibility | undefined) ??
        DEFAULT_VISIBILITY,
    );
    if (chosen !== DEFAULT_VISIBILITY) {
      throw new Error(
        "Visibility is not available yet. Run supabase/migrations/20261017_session_visibility.sql in the Supabase SQL editor, then upload again (or set visibility after the migration).",
      );
    }
    const { visibility: _omit, ...withoutVisibility } = payload.session;
    void _omit;
    sessionInsert = await client
      .from("sessions")
      .insert(withoutVisibility)
      .select("id")
      .single();
  }
  if (sessionInsert.error || !sessionInsert.data?.id) {
    throw new Error(
      sessionInsert.error?.message ?? "Could not create session",
    );
  }
  const sessionId = String(sessionInsert.data.id);

  const lapsWithSession = payload.laps.map((lap) => ({
    ...lap,
    session_id: sessionId,
  }));

  const lapResult = await client
    .from("laps")
    .insert(lapsWithSession)
    .select("id, lap_number");
  if (lapResult.error) throw new Error(lapResult.error.message);
  const insertedLaps = (lapResult.data ?? []) as Array<{
    id: string;
    lap_number?: number;
  }>;
  const firstLapId = insertedLaps[0]?.id ?? null;

  for (const video of payload.videos) {
    const { error: videoError } = await client
      .from("session_videos")
      .insert({
        ...video,
        session_id: sessionId,
        lap_id: video.lap_id ?? firstLapId,
      })
      .select("id")
      .single();
    if (videoError) throw new Error(videoError.message);
  }

  return { sessionId, lapCount: laps.length };
}
