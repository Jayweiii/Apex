"use client";

import { listLocalSessions, type StoredSession } from "@/lib/local-store";
import { createClient } from "@/lib/supabase/client";
import { useEffect, useState } from "react";

/**
 * One-time migration of browser localStorage sessions into the signed-in
 * Supabase account (telemetry + video metadata). Raw blobs stay in R2/IDB.
 */
export function ImportLocalSessions() {
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCount(listLocalSessions().filter((s) => s.kind === "upload").length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [message]);

  async function migrate() {
    setBusy(true);
    setMessage(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in first");

      const locals = listLocalSessions().filter((s) => s.kind === "upload");
      let imported = 0;
      for (const local of locals) {
        const ok = await importOne(supabase, user.id, local);
        if (ok) imported += 1;
      }
      setMessage(`Imported ${imported} of ${locals.length} local sessions.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4 sm:p-5">
      <h2 className="text-sm font-medium text-zinc-200">
        Import local sessions
      </h2>
      <p className="mt-1 text-sm text-zinc-500">
        Copy {count} browser upload{count === 1 ? "" : "s"} into your account so
        friends can see laps and videos. Raw files stay where they are (R2 /
        IndexedDB).
      </p>
      <button
        type="button"
        disabled={busy || count === 0}
        onClick={migrate}
        className="mt-4 min-h-11 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
      >
        {busy ? "Importing…" : "Import my local sessions"}
      </button>
      {message ? <p className="mt-3 text-sm text-zinc-400">{message}</p> : null}
    </section>
  );
}

async function importOne(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  local: StoredSession,
) {
  const { data: existing } = await supabase
    .from("sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("name", local.name)
    .eq("created_at", local.created_at)
    .maybeSingle();
  if (existing) return false;

  const { data: session, error } = await supabase
    .from("sessions")
    .insert({
      id: local.id,
      user_id: userId,
      name: local.name,
      filename: local.filename,
      track_id: local.trackId ?? null,
      car: local.car ?? null,
      car_class: local.carClass ?? null,
      car_tags: local.carTags ?? [],
      driver_name: local.driver ?? null,
      weather: local.weather ?? null,
      tires: local.tires ?? null,
      notes: local.notes ?? null,
      source_kind: local.sourceKind ?? "csv",
      gps_quality: local.gpsQuality ?? null,
      raw_object_key: local.rawObjectKey ?? null,
      video_object_key: local.videoObjectKey ?? null,
      storage_backend: local.storageBackend ?? null,
      started_at: local.startedAtMs
        ? new Date(local.startedAtMs).toISOString()
        : null,
      session_date: local.sessionDate ?? null,
      created_at: local.created_at,
      visibility: "friends",
    })
    .select("id")
    .single();
  if (error || !session) {
    // id collision or schema not migrated — try without forcing id
    const retry = await supabase
      .from("sessions")
      .insert({
        user_id: userId,
        name: local.name,
        filename: local.filename,
        track_id: local.trackId ?? null,
        car: local.car ?? null,
        car_class: local.carClass ?? null,
        car_tags: local.carTags ?? [],
        driver_name: local.driver ?? null,
        weather: local.weather ?? null,
        tires: local.tires ?? null,
        notes: local.notes ?? null,
        source_kind: local.sourceKind ?? "csv",
        gps_quality: local.gpsQuality ?? null,
        raw_object_key: local.rawObjectKey ?? null,
        video_object_key: local.videoObjectKey ?? null,
        storage_backend: local.storageBackend ?? null,
        started_at: local.startedAtMs
          ? new Date(local.startedAtMs).toISOString()
          : null,
        session_date: local.sessionDate ?? null,
        visibility: "friends",
      })
      .select("id")
      .single();
    if (retry.error || !retry.data) return false;
    await insertLapsAndVideos(supabase, userId, retry.data.id, local);
    return true;
  }
  await insertLapsAndVideos(supabase, userId, session.id, local);
  return true;
}

async function insertLapsAndVideos(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  sessionId: string,
  local: StoredSession,
) {
  const { data: laps } = await supabase
    .from("laps")
    .insert(
      local.laps.map((lap) => ({
        id: lap.id,
        session_id: sessionId,
        user_id: userId,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        telemetry: lap.telemetry,
        start_offset_sec: lap.start_offset_sec ?? null,
        started_at_ms: lap.started_at_ms ?? null,
      })),
    )
    .select("id, lap_number");

  const lapIdByNumber = new Map(
    (laps ?? []).map((lap) => [lap.lap_number, lap.id] as const),
  );

  for (const video of local.videos ?? []) {
    const localLap = local.laps.find((lap) => lap.id === video.lapId);
    await supabase.from("session_videos").insert({
      id: video.id,
      session_id: sessionId,
      user_id: userId,
      provider: video.provider,
      youtube_id: video.youtubeId ?? null,
      object_key: video.objectKey ?? null,
      title: video.title ?? null,
      lap_id: localLap
        ? (lapIdByNumber.get(localLap.lap_number) ?? null)
        : null,
      offset_sec: video.offsetSec,
      rate: video.rate ?? 1,
      sync_source: video.syncSource,
      video_started_at: video.videoStartedAtMs
        ? new Date(video.videoStartedAtMs).toISOString()
        : null,
    });
  }
}
