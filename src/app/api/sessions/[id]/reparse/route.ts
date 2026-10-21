import {
  REPARSE_BODY_MAX_BYTES,
  reparseBodyTooLargeMessage,
} from "@/lib/reparse-save-body";
import {
  autoBoundsForStoredLap,
  buildReparsedLapRows,
  compactSourceGpsIfDense,
  expandSourceGps,
  preserveMatchedLapSideData,
  remapVideosByLapNumber,
  reparseLapsFromPoints,
  resolveGpsForReparse,
  sessionDerivedFromLaps,
  sourceGpsPayloadBytes,
  sourceGpsPointCount,
  type LapSideData,
  type SourceGpsStored,
} from "@/lib/session-reparse";
import { createClient } from "@/lib/supabase/server";
import { resolveTrackStartFinish } from "@/lib/track-start-finish";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "@/lib/types";
import { NextResponse } from "next/server";

/**
 * Owner-only: re-split laps in place. Keeps session id, YouTube rows, and
 * exclude/trim when lap numbers still match. Accepts client-parsed laps
 * (GoPro file re-select) or re-splits from sessions.source_gps / stitched laps.
 *
 * When dense sourceGps is posted, the server always re-splits from it
 * (authoritative) so Save cannot silently diverge from stored GPS. Client
 * lap point arrays are optional / ignored when sourceGps is dense — keeps
 * the POST under Vercel body limits.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await context.params;

  const contentLength = Number(request.headers.get("content-length") ?? NaN);
  if (
    Number.isFinite(contentLength) &&
    contentLength > REPARSE_BODY_MAX_BYTES
  ) {
    return NextResponse.json(
      {
        error: reparseBodyTooLargeMessage(contentLength),
        code: "payload_too_large",
        bytes: contentLength,
      },
      { status: 413 },
    );
  }

  let body: {
    laps?: unknown;
    sourceGps?: unknown;
    trackId?: unknown;
    startFinish?: unknown;
    startedAtMs?: unknown;
    sessionDate?: unknown;
    gpsQuality?: unknown;
  };
  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Could not read request body", code: "body_read_failed" },
      { status: 400 },
    );
  }
  if (rawText.length > REPARSE_BODY_MAX_BYTES) {
    return NextResponse.json(
      {
        error: reparseBodyTooLargeMessage(rawText.length),
        code: "payload_too_large",
        bytes: rawText.length,
      },
      { status: 413 },
    );
  }
  try {
    body = JSON.parse(rawText) as typeof body;
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

  /** Only set when we have dense full-res GPS — never stitched lap telemetry. */
  let sourceGps: SourceGpsStored | null = null;
  const incomingGps = expandSourceGps(body.sourceGps);
  if (incomingGps.length) {
    sourceGps = compactSourceGpsIfDense(incomingGps);
    if (!sourceGps) {
      return NextResponse.json(
        {
          error:
            "Uploaded GPS is too coarse to store as source_gps. Re-select the original GoPro LRV/MP4 or GPS log.",
          code: "gps_too_coarse",
          needFile: true,
        },
        { status: 422 },
      );
    }
  }

  const trackId =
    typeof body.trackId === "string" && body.trackId.trim()
      ? body.trackId.trim()
      : (session.track_id as string | null);

  let storedTrackSf: unknown = null;
  if (trackId) {
    const { data: trackRow } = await supabase
      .from("tracks")
      .select("start_finish, lat, lon")
      .eq("id", trackId)
      .maybeSingle();
    storedTrackSf = trackRow?.start_finish ?? null;
    if (
      !storedTrackSf &&
      trackRow &&
      Number.isFinite(Number(trackRow.lat)) &&
      Number.isFinite(Number(trackRow.lon))
    ) {
      storedTrackSf = { lat: Number(trackRow.lat), lon: Number(trackRow.lon) };
    }
  }

  const startFinish =
    parseStartFinish(body.startFinish) ??
    resolveTrackStartFinish(trackId, undefined, storedTrackSf);
  const startedAtMs =
    typeof body.startedAtMs === "number" && Number.isFinite(body.startedAtMs)
      ? body.startedAtMs
      : session.started_at
        ? Date.parse(String(session.started_at))
        : undefined;

  let parsedLaps: ParsedLap[] | null = null;

  // Prefer dense source GPS (incoming or already stored) — re-split
  // server-side so Save cannot diverge from what we persist, and so slim
  // client payloads (no lap point arrays) work under body-size limits.
  const resolvedGps = resolveGpsForReparse({
    sourceGps: sourceGps ?? session.source_gps,
    laps: oldLaps,
  });
  if (resolvedGps.from === "source_gps" && resolvedGps.density.ok) {
    try {
      const split = reparseLapsFromPoints(resolvedGps.points, {
        sessionStartedAtMs: Number.isFinite(startedAtMs)
          ? startedAtMs
          : undefined,
        startFinish,
        trackId,
      });
      parsedLaps = split.laps;
      if (!sourceGps) {
        sourceGps = compactSourceGpsIfDense(resolvedGps.points);
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

  if (!parsedLaps) {
    parsedLaps = parseClientLaps(body.laps);
  }

  if (!parsedLaps) {
    if (!resolvedGps.density.ok) {
      return NextResponse.json(
        {
          error: resolvedGps.density.reason,
          code: "gps_too_coarse",
          hz: resolvedGps.density.hz,
          needFile: true,
        },
        { status: 422 },
      );
    }
    try {
      const split = reparseLapsFromPoints(resolvedGps.points, {
        sessionStartedAtMs: Number.isFinite(startedAtMs)
          ? startedAtMs
          : undefined,
        startFinish,
        trackId,
      });
      parsedLaps = split.laps;
      if (!sourceGps && resolvedGps.from === "source_gps") {
        sourceGps = compactSourceGpsIfDense(resolvedGps.points);
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

  const previousSide: LapSideData[] = oldLaps.map((lap) => {
    const bounds = autoBoundsForStoredLap(lap);
    return {
      lap_number: lap.lap_number,
      excluded: lap.excluded,
      exclude_reason: lap.exclude_reason,
      start_offset_override: lap.start_offset_override,
      end_offset_override: lap.end_offset_override,
      auto_start: bounds.autoStart,
      auto_end: bounds.autoEnd,
    };
  });
  const preserved = preserveMatchedLapSideData(previousSide, parsedLaps);
  // Guard: slim Save must never persist 2-pt stubs when we re-split from GPS.
  const thinHot = parsedLaps.filter(
    (lap) =>
      lap.lapTimeMs >= 60_000 &&
      lap.lapTimeMs <= 180_000 &&
      lap.points.length < 20,
  );
  if (thinHot.length) {
    return NextResponse.json(
      {
        error: `Re-parse produced thin telemetry on lap ${thinHot[0]!.lapNumber} (${thinHot[0]!.points.length} pts). source_gps may be corrupt — re-select the original GPS file.`,
        code: "thin_telemetry",
        lapNumber: thinHot[0]!.lapNumber,
        points: thinHot[0]!.points.length,
      },
      { status: 422 },
    );
  }
  const lapInserts = buildReparsedLapRows(
    user.id,
    sessionId,
    parsedLaps,
    preserved,
  );
  const derived = sessionDerivedFromLaps(
    lapInserts.map((row) => ({
      lap_time_ms: Number(row.lap_time_ms),
      excluded: Boolean(row.excluded),
    })),
  );

  const sessionPatch: Record<string, unknown> = {};
  if (trackId) sessionPatch.track_id = trackId;
  if (sourceGps) {
    const bytes = sourceGpsPayloadBytes(sourceGps);
    if (bytes > 900_000) {
      return NextResponse.json(
        {
          error: `source_gps blob is ${Math.round(bytes / 1024)} KB — too large for inline jsonb. Apply supabase/migrations/20261020_source_gps_fullres.sql and retry with v2 compact encoding.`,
          code: "source_gps_too_large",
          bytes,
        },
        { status: 413 },
      );
    }
    sessionPatch.source_gps = sourceGps;
  }
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
      const tooBig = /too large|value too long|payload|bytes/i.test(
        patchError.message,
      );
      console.error("reparse session update failed", {
        sessionId,
        userId: user.id,
        message: patchError.message,
        code: patchError.code,
        hasSourceGps: Boolean(sourceGps),
        sourceGpsBytes: sourceGps ? sourceGpsPayloadBytes(sourceGps) : 0,
      });
      return NextResponse.json(
        {
          error: missing
            ? "Run supabase/migrations/20261019_session_source_gps.sql in the Supabase SQL editor, then retry."
            : tooBig
              ? `Could not save source_gps (${patchError.message}). Payload may be too large — re-select the file so GPS is compact v2.`
              : patchError.message,
          code: missing
            ? "missing_source_gps"
            : tooBig
              ? "source_gps_too_large"
              : "session_update_failed",
        },
        { status: missing ? 503 : tooBig ? 413 : 500 },
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("laps")
    .delete()
    .eq("session_id", sessionId)
    .eq("user_id", user.id);
  if (deleteError) {
    console.error("reparse lap delete failed", {
      sessionId,
      message: deleteError.message,
    });
    return NextResponse.json(
      { error: deleteError.message, code: "lap_delete_failed" },
      { status: 500 },
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("laps")
    .insert(lapInserts)
    .select("id, lap_number");
  if (insertError) {
    console.error("reparse lap insert failed", {
      sessionId,
      message: insertError.message,
      lapCount: lapInserts.length,
    });
    return NextResponse.json(
      { error: insertError.message, code: "lap_insert_failed" },
      { status: 500 },
    );
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
    const { error: videoError } = await supabase
      .from("session_videos")
      .update({
        lap_id: video.lapId ?? null,
        lap_index: video.lapIndex ?? null,
      })
      .eq("id", video.id)
      .eq("user_id", user.id);
    if (videoError) {
      console.error("reparse video remap failed", {
        sessionId,
        videoId: video.id,
        message: videoError.message,
      });
    }
  }

  const clearedTrimCount = [...preserved.values()].filter((side) => {
    const prev = previousSide.find((p) => p.lap_number === side.lap_number);
    if (!prev) return false;
    return (
      (prev.start_offset_override != null || prev.end_offset_override != null) &&
      side.start_offset_override == null &&
      side.end_offset_override == null
    );
  }).length;

  return NextResponse.json({
    ok: true,
    lapCount: parsedLaps.length,
    preservedLapMeta: [...preserved.keys()].length,
    clearedStaleTrim: clearedTrimCount,
    sessionBestMs: derived.sessionBestMs,
    sourceGpsStored: Boolean(sourceGps),
    sourceGpsPoints: sourceGps ? sourceGpsPointCount(sourceGps) : 0,
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
    // Slim Save omits points when sourceGps is present — those payloads are
    // handled by server-side re-split, not this path.
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
