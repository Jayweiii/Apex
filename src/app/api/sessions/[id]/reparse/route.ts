import {
  buildReparsedLapRows,
  compactSourceGps,
  expandSourceGps,
  preserveMatchedLapSideData,
  remapVideosByLapNumber,
  reparseLapsFromPoints,
  resolveGpsForReparse,
  type CompactGpsPoint,
  type LapSideData,
} from "@/lib/session-reparse";
import { createClient } from "@/lib/supabase/server";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "@/lib/types";
import { NextResponse } from "next/server";

/**
 * Owner-only: re-split laps in place. Keeps session id, YouTube rows, and
 * exclude/trim when lap numbers still match. Accepts client-parsed laps
 * (GoPro file re-select) or re-splits from sessions.source_gps / stitched laps.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await context.params;
  let body: {
    laps?: unknown;
    sourceGps?: unknown;
    trackId?: unknown;
    startFinish?: unknown;
    startedAtMs?: unknown;
    sessionDate?: unknown;
    gpsQuality?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .select(
      "id, user_id, track_id, started_at, session_date, source_gps, source_kind",
    )
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (sessionError) {
    const missing = /source_gps/i.test(sessionError.message);
    return NextResponse.json(
      {
        error: missing
          ? "Run supabase/migrations/20261019_session_source_gps.sql in the Supabase SQL editor, then retry."
          : sessionError.message,
        code: missing ? "missing_source_gps" : "load_failed",
      },
      { status: missing ? 503 : 400 },
    );
  }
  if (!session) {
    return NextResponse.json(
      { error: "Session not found or you are not the owner" },
      { status: 404 },
    );
  }

  const { data: oldLapRows, error: lapsError } = await supabase
    .from("laps")
    .select(
      "id, lap_number, telemetry, start_offset_sec, excluded, exclude_reason, start_offset_override, end_offset_override",
    )
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .order("lap_number", { ascending: true });
  if (lapsError) {
    return NextResponse.json({ error: lapsError.message }, { status: 400 });
  }

  const oldLaps = (oldLapRows ?? []) as Array<{
    id: string;
    lap_number: number;
    telemetry: TelemetryPoint[] | null;
    start_offset_sec: number | null;
    excluded?: boolean | null;
    exclude_reason?: string | null;
    start_offset_override?: number | null;
    end_offset_override?: number | null;
  }>;

  const { data: videoRows } = await supabase
    .from("session_videos")
    .select(
      "id, provider, youtube_id, youtube_url, object_key, title, lap_id, lap_index, offset_sec, rate, sync_source, video_started_at",
    )
    .eq("session_id", sessionId)
    .eq("user_id", user.id);

  let parsedLaps: ParsedLap[] | null = parseClientLaps(body.laps);
  let sourceGps: CompactGpsPoint[] | null = null;
  const incomingGps = expandSourceGps(body.sourceGps);
  if (incomingGps.length) {
    sourceGps = compactSourceGps(incomingGps);
  }

  const trackId =
    typeof body.trackId === "string" && body.trackId.trim()
      ? body.trackId.trim()
      : (session.track_id as string | null);
  const startFinish = parseStartFinish(body.startFinish);
  const startedAtMs =
    typeof body.startedAtMs === "number" && Number.isFinite(body.startedAtMs)
      ? body.startedAtMs
      : session.started_at
        ? Date.parse(String(session.started_at))
        : undefined;

  if (!parsedLaps) {
    const resolved = resolveGpsForReparse({
      sourceGps: sourceGps ?? session.source_gps,
      laps: oldLaps,
    });
    if (!resolved.density.ok) {
      return NextResponse.json(
        {
          error: resolved.density.reason,
          code: "gps_too_coarse",
          hz: resolved.density.hz,
          needFile: true,
        },
        { status: 422 },
      );
    }
    try {
      const split = reparseLapsFromPoints(resolved.points, {
        sessionStartedAtMs: Number.isFinite(startedAtMs)
          ? startedAtMs
          : undefined,
        startFinish,
        trackId,
      });
      parsedLaps = split.laps;
      if (!sourceGps) {
        sourceGps = compactSourceGps(resolved.points);
      }
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Could not detect laps — choose start/finish or re-select the original GPS file.",
          code: "split_failed",
          needStartFinish: true,
        },
        { status: 422 },
      );
    }
  }

  if (!parsedLaps.length) {
    return NextResponse.json(
      { error: "Re-parse produced no laps", code: "no_laps" },
      { status: 422 },
    );
  }

  const previousSide: LapSideData[] = oldLaps.map((lap) => ({
    lap_number: lap.lap_number,
    excluded: lap.excluded,
    exclude_reason: lap.exclude_reason,
    start_offset_override: lap.start_offset_override,
    end_offset_override: lap.end_offset_override,
  }));
  const preserved = preserveMatchedLapSideData(previousSide, parsedLaps);
  const lapInserts = buildReparsedLapRows(
    user.id,
    sessionId,
    parsedLaps,
    preserved,
  );

  const sessionPatch: Record<string, unknown> = {};
  if (trackId) sessionPatch.track_id = trackId;
  if (sourceGps) sessionPatch.source_gps = sourceGps;
  if (typeof body.sessionDate === "string") {
    sessionPatch.session_date = body.sessionDate;
  }
  if (typeof body.startedAtMs === "number" && Number.isFinite(body.startedAtMs)) {
    sessionPatch.started_at = new Date(body.startedAtMs).toISOString();
  }
  if (body.gpsQuality && typeof body.gpsQuality === "object") {
    sessionPatch.gps_quality = body.gpsQuality;
  }

  if (Object.keys(sessionPatch).length) {
    const { error: patchError } = await supabase
      .from("sessions")
      .update(sessionPatch)
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (patchError) {
      const missing = /source_gps/i.test(patchError.message);
      return NextResponse.json(
        {
          error: missing
            ? "Run supabase/migrations/20261019_session_source_gps.sql in the Supabase SQL editor, then retry."
            : patchError.message,
          code: missing ? "missing_source_gps" : "session_update_failed",
        },
        { status: missing ? 503 : 500 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("laps")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from("laps")
    .insert(lapInserts)
    .select("id, lap_number");
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const nextLapNumberToId = new Map<number, string>();
  for (const row of inserted ?? []) {
    nextLapNumberToId.set(Number(row.lap_number), String(row.id));
  }
  const previousLapIdToNumber = new Map(
    oldLaps.map((lap) => [lap.id, lap.lap_number] as const),
  );

  const videos: SessionVideo[] = (videoRows ?? []).map((row) => ({
    id: String(row.id),
    provider: row.provider as "youtube" | "mp4",
    youtubeId: row.youtube_id ?? undefined,
    youtubeUrl: row.youtube_url ?? undefined,
    objectKey: row.object_key ?? undefined,
    title: row.title ?? undefined,
    lapId: row.lap_id ?? null,
    lapIndex: row.lap_index ?? null,
    offsetSec: Number(row.offset_sec ?? 0),
    rate: Number(row.rate ?? 1),
    syncSource: (row.sync_source ?? "unsynced") as SessionVideo["syncSource"],
    videoStartedAtMs: row.video_started_at
      ? Date.parse(String(row.video_started_at))
      : undefined,
  }));

  const remapped = remapVideosByLapNumber(
    videos,
    previousLapIdToNumber,
    nextLapNumberToId,
  );

  for (const video of remapped) {
    await supabase
      .from("session_videos")
      .update({
        lap_id: video.lapId ?? null,
        lap_index: video.lapIndex ?? null,
      })
      .eq("id", video.id)
      .eq("user_id", user.id);
  }

  return NextResponse.json({
    ok: true,
    lapCount: parsedLaps.length,
    preservedLapMeta: [...preserved.keys()].length,
    sourceGpsStored: Boolean(sourceGps),
  });
}

function parseClientLaps(raw: unknown): ParsedLap[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const laps: ParsedLap[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const lapNumber = Number(row.lapNumber ?? row.lap_number);
    const lapTimeMs = Number(row.lapTimeMs ?? row.lap_time_ms);
    const points = row.points ?? row.telemetry;
    if (!Number.isFinite(lapNumber) || !Number.isFinite(lapTimeMs)) continue;
    if (!Array.isArray(points) || points.length < 2) continue;
    laps.push({
      lapNumber,
      lapTimeMs,
      points: points as TelemetryPoint[],
      startOffsetSec:
        typeof row.startOffsetSec === "number"
          ? row.startOffsetSec
          : typeof row.start_offset_sec === "number"
            ? row.start_offset_sec
            : undefined,
      startedAtMs:
        typeof row.startedAtMs === "number"
          ? row.startedAtMs
          : typeof row.started_at_ms === "number"
            ? row.started_at_ms
            : undefined,
    });
  }
  return laps.length ? laps : null;
}

function parseStartFinish(
  raw: unknown,
): { lat: number; lon: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}
