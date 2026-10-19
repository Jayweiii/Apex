"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import {
  catalogSessionsForTrack,
  loadCatalogSession,
} from "@/lib/catalog";
import { fetchSharedTracks } from "@/lib/cloud-tracks";
import {
  groupLapsBySession,
  type AccessibleSessionMeta,
  type CompareSessionOption,
} from "@/lib/compare-sessions";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { setSharedTracksCache } from "@/lib/tracks";
import type { LapRow, SessionRow, SessionVideo } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type VideoRow = {
  id: string;
  session_id: string;
  provider: string;
  youtube_id?: string | null;
  object_key?: string | null;
  title?: string | null;
  lap_id?: string | null;
  offset_sec?: number | null;
  rate?: number | null;
  sync_source?: string | null;
  video_started_at?: string | null;
};

function videosBySession(rows: VideoRow[]): Map<string, SessionVideo[]> {
  const map = new Map<string, SessionVideo[]>();
  for (const row of rows) {
    const started = row.video_started_at
      ? Date.parse(row.video_started_at)
      : NaN;
    const video: SessionVideo = {
      id: row.id,
      provider: row.provider === "youtube" ? "youtube" : "mp4",
      youtubeId: row.youtube_id ?? undefined,
      objectKey: row.object_key ?? undefined,
      title: row.title ?? undefined,
      lapId: row.lap_id ?? null,
      offsetSec: row.offset_sec ?? 0,
      rate: row.rate ?? 1,
      syncSource:
        (row.sync_source as SessionVideo["syncSource"] | null) ?? "unsynced",
      videoStartedAtMs: Number.isFinite(started) ? started : undefined,
    };
    const list = map.get(row.session_id) ?? [];
    list.push(video);
    map.set(row.session_id, list);
  }
  return map;
}

async function catalogAsCompareOptions(
  trackId: string | null | undefined,
): Promise<CompareSessionOption[]> {
  if (!trackId) return [];
  const entries = catalogSessionsForTrack(trackId).slice(0, 6);
  const loaded = await Promise.all(
    entries.map((entry) => loadCatalogSession(entry.id)),
  );
  return loaded
    .filter((item): item is NonNullable<typeof item> => item != null)
    .map((item) => ({
      id: item.id,
      name: item.name,
      car: item.car,
      kind: item.kind,
      trackId: item.trackId,
      laps: item.laps.map((lap) => ({
        id: lap.id,
        session_id: item.id,
        user_id: "catalog",
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        telemetry: lap.telemetry,
      })),
    }));
}

async function fetchAccessibleSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  trackId: string | null | undefined,
  limit: number,
): Promise<{ rows: AccessibleSessionMeta[]; error: string | null }> {
  const selectCols =
    "id, name, track_id, car, driver_name, user_id, visibility, created_at, source_kind, gps_quality";
  const withVisibility = trackId
    ? await supabase
        .from("sessions")
        .select(selectCols)
        .eq("track_id", trackId)
        .order("created_at", { ascending: false })
        .limit(limit)
    : await supabase
        .from("sessions")
        .select(selectCols)
        .order("created_at", { ascending: false })
        .limit(limit);

  if (
    withVisibility.error &&
    /visibility|gps_quality/i.test(String(withVisibility.error.message ?? ""))
  ) {
    const without = trackId
      ? await supabase
          .from("sessions")
          .select(
            "id, name, track_id, car, driver_name, user_id, created_at, source_kind",
          )
          .eq("track_id", trackId)
          .order("created_at", { ascending: false })
          .limit(limit)
      : await supabase
          .from("sessions")
          .select(
            "id, name, track_id, car, driver_name, user_id, created_at, source_kind",
          )
          .order("created_at", { ascending: false })
          .limit(limit);
    if (without.error) {
      return { rows: [], error: without.error.message };
    }
    return {
      rows: (without.data ?? []) as AccessibleSessionMeta[],
      error: null,
    };
  }

  if (withVisibility.error) {
    return { rows: [], error: withVisibility.error.message };
  }
  return {
    rows: (withVisibility.data ?? []) as AccessibleSessionMeta[],
    error: null,
  };
}

/**
 * Cloud compare: current session plus every accessible peer
 * (own / friends / public via RLS) and catalog demos, filterable by track.
 */
export function CloudCompareView({
  id,
  initialRef,
  initialOther,
  initialOtherSession,
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
}) {
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<
    | (SessionRow & { track_id?: string | null; car?: string | null })
    | null
    | undefined
  >(undefined);
  const [compareSessions, setCompareSessions] = useState<CompareSessionOption[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setSession(null);
          setError("Supabase is not configured.");
        }
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        setEmail(user?.email ?? undefined);
        setUserId(user?.id ?? null);

        // Populate shared track names for filters / labels.
        try {
          const shared = await fetchSharedTracks(supabase);
          if (!cancelled) setSharedTracksCache(shared);
        } catch {
          // optional until migration
        }

        const { data: row, error: sessionError } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (cancelled) return;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          return;
        }
        if (!row) {
          setSession(null);
          setError(user ? "not-found" : "sign-in");
          return;
        }
        const current = row as SessionRow & {
          track_id?: string | null;
          car?: string | null;
        };
        setSession(current);

        // Same-track peers first (RLS: own + friends; + public after migration).
        const sameTrack = await fetchAccessibleSessions(
          supabase,
          current.track_id,
          80,
        );
        if (sameTrack.error) {
          if (!cancelled) setError(sameTrack.error);
          return;
        }

        const metas = [...sameTrack.rows];
        if (!metas.some((meta) => meta.id === current.id)) {
          metas.unshift({
            id: current.id,
            name: current.name,
            track_id: current.track_id,
            car: current.car,
            user_id: current.user_id,
          });
        }

        // Broader recent accessible sessions for the track filter.
        const broad = await fetchAccessibleSessions(supabase, null, 60);
        for (const meta of broad.rows) {
          if (!metas.some((existing) => existing.id === meta.id)) {
            metas.push(meta);
          }
        }

        const ids = metas.map((meta) => meta.id);
        const { data: lapRows, error: lapsError } = await supabase
          .from("laps")
          .select("*")
          .in("session_id", ids)
          .order("lap_number", { ascending: true });
        if (lapsError) {
          if (!cancelled) setError(lapsError.message);
          return;
        }

        const { data: videoRows } = await supabase
          .from("session_videos")
          .select(
            "id, session_id, provider, youtube_id, object_key, title, lap_id, offset_sec, rate, sync_source, video_started_at",
          )
          .in("session_id", ids);

        const videosMap = videosBySession((videoRows ?? []) as VideoRow[]);
        const cloudOptions = groupLapsBySession(
          metas,
          (lapRows ?? []) as LapRow[],
          user?.id ?? null,
        ).map((option) => ({
          ...option,
          videos: (videosMap.get(option.id) ?? []).filter(
            (v) => v.provider === "youtube" && v.youtubeId,
          ),
        }));
        const catalogOptions = (
          await catalogAsCompareOptions(current.track_id)
        ).filter(
          (option) => !cloudOptions.some((cloud) => cloud.id === option.id),
        );

        if (!cancelled) {
          const merged = new Map<string, CompareSessionOption>();
          for (const option of [...cloudOptions, ...catalogOptions]) {
            if (!merged.has(option.id)) merged.set(option.id, option);
          }
          setCompareSessions([...merged.values()]);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const currentLaps = useMemo(() => {
    const match = compareSessions.find((option) => option.id === id);
    return match?.laps ?? [];
  }, [compareSessions, id]);

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-500">Loading compare…</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          {error === "sign-in" ? (
            <>
              <p className="text-sm text-zinc-300">
                Sign in to compare against friends&apos; and public sessions.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/sessions/${id}/compare`)}`}
                className="mt-4 inline-block text-sm text-orange-400"
              >
                Sign in
              </Link>
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              {error === "not-found"
                ? "Session not found (or you do not have access)."
                : (error ?? "Session not found.")}
            </p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <Link
            href={`/sessions/${session.id}`}
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {session.name}
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Compare laps
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Pick any lap from your sessions, friends, or public uploads
            {session.track_id ? " — filter by track" : ""}.
            {!userId
              ? " Sign in to see friends' sessions."
              : ""}
          </p>
          {error ? (
            <p className="mt-2 text-sm text-amber-200">{error}</p>
          ) : null}
        </div>
        <LapCompare
          laps={currentLaps}
          sessions={compareSessions}
          initialRef={initialRef}
          initialOther={initialOther}
          initialOtherSession={initialOtherSession}
          initialTrackId={session.track_id ?? undefined}
        />
      </main>
    </>
  );
}
