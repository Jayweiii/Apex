"use client";

import { AppHeader } from "@/components/AppHeader";
import { ComparePageSkeleton } from "@/components/PageSkeleton";
import { SaveComparisonControls } from "@/components/SaveComparisonControls";
import type { ComparisonDraftSnapshot } from "@/lib/comparisons";
import { fetchSharedTracks } from "@/lib/cloud-tracks";
import {
  groupLapsBySession,
  type AccessibleSessionMeta,
  type CompareSessionOption,
} from "@/lib/compare-sessions";
import {
  LAP_META_COLUMNS,
  LAP_TELEMETRY_COLUMNS,
  SESSION_LIST_COLUMNS,
  lapsMissingTelemetry,
  mergeLapTelemetry,
} from "@/lib/lap-query";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { setSharedTracksCache } from "@/lib/tracks";
import type { LapRow, SessionRow, SessionVideo } from "@/lib/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LapCompare = dynamic(
  () =>
    import("@/components/LapCompare").then((mod) => ({
      default: mod.LapCompare,
    })),
  {
    ssr: false,
    loading: () => <ComparePageSkeleton />,
  },
);

type VideoRow = {
  id: string;
  session_id: string;
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
      youtubeUrl: row.youtube_url ?? undefined,
      objectKey: row.object_key ?? undefined,
      title: row.title ?? undefined,
      lapId: row.lap_id ?? null,
      lapIndex: row.lap_index ?? null,
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

async function fetchAccessibleSessions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  trackId: string | null | undefined,
  limit: number,
): Promise<{ rows: AccessibleSessionMeta[]; error: string | null }> {
  const selectCols = SESSION_LIST_COLUMNS;
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

function seedLapIdsFromUrl(args: {
  initialRef?: string;
  initialOther?: string;
  initialLaps?: string;
}): string[] {
  const ids: string[] = [];
  if (args.initialRef) ids.push(args.initialRef);
  if (args.initialOther) ids.push(args.initialOther);
  if (args.initialLaps) {
    for (const part of args.initialLaps.split(",")) {
      const lapId = part.includes(":") ? part.split(":")[1] : part;
      if (lapId) ids.push(lapId.trim());
    }
  }
  return [...new Set(ids.filter(Boolean))];
}

/**
 * Cloud compare: current session plus every accessible peer
 * (own / friends / public via RLS), filterable by track.
 */
export function CloudCompareView({
  id,
  initialRef,
  initialOther,
  initialOtherSession,
  initialLaps,
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
  initialLaps?: string;
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
  /** True after the first sessions+laps fetch finishes (even if empty). */
  const [sessionsReady, setSessionsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ComparisonDraftSnapshot | null>(null);
  const inflightTelemetry = useRef<Set<string>>(new Set());
  const onDraftChange = useCallback((next: ComparisonDraftSnapshot) => {
    setDraft(next);
  }, []);

  const mergeTelemetryRows = useCallback((rows: LapRow[]) => {
    if (!rows.length) return;
    setCompareSessions((prev) =>
      prev.map((option) => ({
        ...option,
        laps: mergeLapTelemetry(option.laps, rows),
      })),
    );
  }, []);

  const fetchLapTelemetry = useCallback(
    async (lapIds: string[]) => {
      const unique = [...new Set(lapIds)].filter(
        (lapId) => lapId && !inflightTelemetry.current.has(lapId),
      );
      if (!unique.length || !hasSupabaseConfig()) return;
      for (const lapId of unique) inflightTelemetry.current.add(lapId);
      try {
        const supabase = createClient();
        const { data, error: telError } = await supabase
          .from("laps")
          .select(LAP_TELEMETRY_COLUMNS)
          .in("id", unique);
        if (telError) {
          setError(telError.message);
          return;
        }
        mergeTelemetryRows((data ?? []) as LapRow[]);
      } finally {
        for (const lapId of unique) inflightTelemetry.current.delete(lapId);
      }
    },
    [mergeTelemetryRows],
  );

  const onRequestLapTelemetry = useCallback(
    (lapIds: string[]) => {
      const allLaps = compareSessions.flatMap((option) => option.laps);
      const missing = lapsMissingTelemetry(allLaps, lapIds);
      if (missing.length) void fetchLapTelemetry(missing);
    },
    [compareSessions, fetchLapTelemetry],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setSession(null);
          setSessionsReady(true);
          setError("Supabase is not configured.");
        }
        return;
      }
      try {
        const supabase = createClient();
        const [{ data: authData }, sharedResult, sessionResult] =
          await Promise.all([
            supabase.auth.getUser(),
            fetchSharedTracks(supabase).catch(() => null),
            supabase
              .from("sessions")
              .select(SESSION_LIST_COLUMNS)
              .eq("id", id)
              .maybeSingle(),
          ]);
        if (cancelled) return;
        const user = authData.user;
        setEmail(user?.email ?? undefined);
        setUserId(user?.id ?? null);
        if (sharedResult) setSharedTracksCache(sharedResult);

        const { data: row, error: sessionError } = sessionResult;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          setSessionsReady(true);
          return;
        }
        if (!row) {
          setSession(null);
          setSessionsReady(true);
          setError("not-found");
          return;
        }
        const current = row as unknown as SessionRow & {
          track_id?: string | null;
          car?: string | null;
        };
        setSession(current);

        // Same-track + broad peers in parallel (RLS: own / friends / public).
        const [sameTrack, broad] = await Promise.all([
          fetchAccessibleSessions(supabase, current.track_id, 80),
          fetchAccessibleSessions(supabase, null, 60),
        ]);
        if (cancelled) return;
        if (sameTrack.error) {
          setError(sameTrack.error);
          setSessionsReady(true);
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
            created_at: current.created_at,
          });
        }
        for (const meta of broad.rows) {
          if (!metas.some((existing) => existing.id === meta.id)) {
            metas.push(meta);
          }
        }

        const ids = metas.map((meta) => meta.id);
        const [lapsResult, videosResult] = await Promise.all([
          supabase
            .from("laps")
            .select(LAP_META_COLUMNS)
            .in("session_id", ids)
            .order("lap_number", { ascending: true }),
          supabase
            .from("session_videos")
            .select(
              "id, session_id, provider, youtube_id, youtube_url, object_key, title, lap_id, lap_index, offset_sec, rate, sync_source, video_started_at",
            )
            .in("session_id", ids),
        ]);
        if (cancelled) return;
        if (lapsResult.error) {
          setError(lapsResult.error.message);
          setSessionsReady(true);
          return;
        }

        const metaLaps = (lapsResult.data ?? []).map((lap) => ({
          ...(lap as LapRow),
          telemetry: [] as LapRow["telemetry"],
        }));
        const videosMap = videosBySession(
          (videosResult.data ?? []) as VideoRow[],
        );
        const cloudOptions = groupLapsBySession(
          metas,
          metaLaps,
          user?.id ?? null,
        ).map((option) => ({
          ...option,
          videos: (videosMap.get(option.id) ?? []).filter(
            (v) => v.provider === "youtube" && v.youtubeId,
          ),
        }));

        // URL session first so LapCompare seeds its best lap, not a peer's.
        const ordered = [...cloudOptions];
        const primaryIdx = ordered.findIndex((option) => option.id === id);
        if (primaryIdx > 0) {
          const [primary] = ordered.splice(primaryIdx, 1);
          if (primary) ordered.unshift(primary);
        }
        setCompareSessions(ordered);
        setSessionsReady(true);

        // Prefetch telemetry for seeded slots only (not every peer lap).
        const primaryLaps =
          ordered.find((option) => option.id === id)?.laps ?? [];
        const rankedPrimary = [...primaryLaps]
          .filter((lap) => !lap.excluded)
          .sort((a, b) => a.lap_time_ms - b.lap_time_ms);
        const urlLapIds = seedLapIdsFromUrl({
          initialRef,
          initialOther,
          initialLaps,
        });
        const prefetchIds = [
          ...rankedPrimary.slice(0, 2).map((lap) => lap.id),
          ...urlLapIds,
        ];
        if (initialOtherSession) {
          const peer =
            ordered.find((option) => option.id === initialOtherSession)?.laps ??
            [];
          const rankedPeer = [...peer]
            .filter((lap) => !lap.excluded)
            .sort((a, b) => a.lap_time_ms - b.lap_time_ms);
          for (const lap of rankedPeer.slice(0, 2)) prefetchIds.push(lap.id);
        }
        if (prefetchIds.length) {
          void fetchLapTelemetry(prefetchIds);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setSessionsReady(true);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    id,
    initialRef,
    initialOther,
    initialOtherSession,
    initialLaps,
    fetchLapTelemetry,
  ]);

  const currentLaps = useMemo(() => {
    const match = compareSessions.find((option) => option.id === id);
    return match?.laps ?? [];
  }, [compareSessions, id]);

  if (session === undefined || (session && !sessionsReady)) {
    return (
      <>
        <AppHeader email={email} />
        <ComparePageSkeleton />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-400">
            {error === "not-found" || !error
              ? "Session not found, or it is private / friends-only."
              : error}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Public sessions compare without an account.
            {!userId ? (
              <>
                {" "}
                <Link
                  href={`/login?next=${encodeURIComponent(`/sessions/${id}/compare`)}`}
                  className="text-orange-400"
                >
                  Sign in
                </Link>{" "}
                to include Friends-visible peers.
              </>
            ) : null}
          </p>
        </main>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader email={email} />
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-3 py-1.5 pb-8 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
          <div className="min-w-0">
            <Link
              href={`/sessions/${session.id}`}
              prefetch
              className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
            >
              {session.name}
            </Link>
            <h1 className="truncate text-base font-semibold tracking-tight text-zinc-50 sm:text-lg">
              Compare laps
            </h1>
            {error ? (
              <p className="mt-0.5 text-xs text-amber-200">{error}</p>
            ) : null}
          </div>
          <SaveComparisonControls draft={draft} />
        </div>
        <LapCompare
          laps={currentLaps}
          sessions={compareSessions}
          primarySessionId={id}
          initialRef={initialRef}
          initialOther={initialOther}
          initialOtherSession={initialOtherSession}
          initialLaps={initialLaps}
          initialTrackId={session.track_id ?? undefined}
          onDraftChange={onDraftChange}
          onRequestLapTelemetry={onRequestLapTelemetry}
        />
      </main>
    </div>
  );
}
