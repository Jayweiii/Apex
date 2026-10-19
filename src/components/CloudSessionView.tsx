"use client";

import { AppHeader } from "@/components/AppHeader";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { LapChips, LapList, type LapExcludeChange } from "@/components/LapList";
import { SessionLapDetail } from "@/components/SessionLapDetail";
import { videoCoverage } from "@/lib/pick-session-video";
import { SessionVideosCard } from "@/components/SessionVideosCard";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { useSessionLapSelection } from "@/components/useSessionLapSelection";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import type { GpsQuality } from "@/lib/gps-quality";
import { bestLapTimeMs } from "@/lib/lap-quality";
import {
  deleteSessionVideo,
  fetchSessionVideos,
  updateSessionVideoSync,
  upsertSessionVideo,
} from "@/lib/session-videos-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, SessionVideo, TelemetryPoint } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CloudSession = {
  id: string;
  name: string;
  user_id: string;
  car?: string | null;
  driver_name?: string | null;
  track_id?: string | null;
  visibility?: string | null;
  source_kind?: string | null;
  gps_quality?: GpsQuality | null;
  started_at?: string | null;
  session_date?: string | null;
  created_at: string;
};

/**
 * Loads a cloud session with the browser Supabase client so auth cookies
 * that work for uploads also work for viewing (avoids LocalSession "not found").
 * Lap selection is in-place via ?lap=N — no separate lap page.
 */
export function CloudSessionView({ id }: { id: string }) {
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<CloudSession | null | undefined>(
    undefined,
  );
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [videos, setVideos] = useState<SessionVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [excludeError, setExcludeError] = useState<string | null>(null);
  const [excludeBusyId, setExcludeBusyId] = useState<string | null>(null);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [trimBusy, setTrimBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setSession(null);
          setError("Supabase is not configured in this environment.");
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
          // Public rows load via anon RLS. Missing ⇒ not found or private/friends.
          setSession(null);
          setError("not-found");
          return;
        }
        setSession(row as CloudSession);

        const { data: lapRows } = await supabase
          .from("laps")
          .select("*")
          .eq("session_id", id)
          .order("lap_number", { ascending: true });
        if (!cancelled) setLaps((lapRows ?? []) as LapRow[]);

        try {
          const cloudVideos = await fetchSessionVideos(supabase, id);
          // YouTube-only UI — keep YouTube rows (legacy mp4 rows ignored in card).
          if (!cancelled) {
            setVideos(
              cloudVideos.filter(
                (v) => v.provider === "youtube" && v.youtubeId,
              ),
            );
          }
        } catch {
          if (!cancelled) setVideos([]);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load session");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pickLaps = useMemo(
    () =>
      laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
      })),
    [laps],
  );
  const { selected, selectLap, videoParam } = useSessionLapSelection(pickLaps);

  const selectedRow = useMemo(
    () => (selected ? laps.find((lap) => lap.id === selected.id) ?? null : null),
    [laps, selected],
  );

  const detailLaps = useMemo(
    () =>
      laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        start_offset_sec: lap.start_offset_sec,
        telemetry: (lap.telemetry ?? []) as TelemetryPoint[],
        excluded: lap.excluded ?? false,
        exclude_reason: lap.exclude_reason ?? null,
        start_offset_override: lap.start_offset_override ?? null,
        end_offset_override: lap.end_offset_override ?? null,
      })),
    [laps],
  );

  async function reloadLaps() {
    if (!session) return;
    const supabase = createClient();
    const { data: lapRows } = await supabase
      .from("laps")
      .select("*")
      .eq("session_id", session.id)
      .order("lap_number", { ascending: true });
    setLaps((lapRows ?? []) as LapRow[]);
  }

  async function onTrimChange(change: {
    lapId: string;
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) {
    if (!session || !userId || session.user_id !== userId || trimBusy) return;
    setTrimError(null);
    setTrimBusy(true);
    setLaps((rows) =>
      rows.map((lap) =>
        lap.id === change.lapId
          ? {
              ...lap,
              start_offset_override: change.start_offset_override,
              end_offset_override: change.end_offset_override,
            }
          : lap,
      ),
    );
    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${change.lapId}/trim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            start_offset_override: change.start_offset_override,
            end_offset_override: change.end_offset_override,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        lap_time_ms?: number;
        start_offset_override?: number | null;
        end_offset_override?: number | null;
      };
      if (!response.ok) {
        setTrimError(
          payload.error ??
            "Could not save lap trim. Run 20261019_lap_trim_overrides.sql if columns are missing.",
        );
        await reloadLaps();
        return;
      }
      setLaps((rows) =>
        rows.map((lap) =>
          lap.id === change.lapId
            ? {
                ...lap,
                lap_time_ms: payload.lap_time_ms ?? lap.lap_time_ms,
                start_offset_override: payload.start_offset_override ?? null,
                end_offset_override: payload.end_offset_override ?? null,
              }
            : lap,
        ),
      );
      // Reload videos in case dedicated offsets shifted.
      try {
        const supabase = createClient();
        const cloudVideos = await fetchSessionVideos(supabase, session.id);
        setVideos(
          cloudVideos.filter((v) => v.provider === "youtube" && v.youtubeId),
        );
      } catch {
        // keep existing videos
      }
    } finally {
      setTrimBusy(false);
    }
  }

  async function onTrimReset(lapId: string) {
    await onTrimChange({
      lapId,
      start_offset_override: null,
      end_offset_override: null,
    });
  }

  async function onMergeNext(lapId: string) {
    if (!session || !userId || session.user_id !== userId || trimBusy) return;
    setTrimBusy(true);
    setTrimError(null);
    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${lapId}/trim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ merge_next: true }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setTrimError(payload.error ?? "Merge failed");
        return;
      }
      await reloadLaps();
    } finally {
      setTrimBusy(false);
    }
  }

  async function onSplit(lapId: string, progress: number) {
    if (!session || !userId || session.user_id !== userId || trimBusy) return;
    setTrimBusy(true);
    setTrimError(null);
    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${lapId}/trim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ split_progress: progress }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setTrimError(payload.error ?? "Split failed");
        return;
      }
      await reloadLaps();
    } finally {
      setTrimBusy(false);
    }
  }

  async function onVisibility(next: SessionVisibility) {
    if (!session || !userId || session.user_id !== userId || visibilityBusy) {
      return;
    }
    const previous = normalizeVisibility(
      session.visibility ?? DEFAULT_VISIBILITY,
    );
    setVisibilityError(null);
    setVisibilityBusy(true);
    setSession({ ...session, visibility: next });

    try {
      const response = await fetch(`/api/sessions/${session.id}/visibility`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ visibility: next }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        visibility?: SessionVisibility;
        code?: string;
      };

      if (response.ok && payload.visibility) {
        setSession({ ...session, visibility: payload.visibility });
        return;
      }

      if (response.status === 401) {
        const supabase = createClient();
        const { data, error: updateError } = await supabase
          .from("sessions")
          .update({ visibility: next })
          .eq("id", session.id)
          .eq("user_id", userId)
          .select("id, visibility")
          .maybeSingle();
        if (updateError) {
          setSession({ ...session, visibility: previous });
          setVisibilityError(
            /visibility/i.test(updateError.message)
              ? "Run supabase/migrations/20261017_session_visibility.sql in the Supabase SQL editor, then retry."
              : updateError.message,
          );
          return;
        }
        if (!data) {
          setSession({ ...session, visibility: previous });
          setVisibilityError("Update blocked — are you the session owner?");
          return;
        }
        setSession({ ...session, visibility: data.visibility ?? next });
        return;
      }

      setSession({ ...session, visibility: previous });
      setVisibilityError(
        payload.error ?? `Could not update visibility (${response.status})`,
      );
    } catch (err) {
      setSession({ ...session, visibility: previous });
      setVisibilityError(
        err instanceof Error ? err.message : "Could not update visibility",
      );
    } finally {
      setVisibilityBusy(false);
    }
  }

  async function onVideosChange(next: SessionVideo[]) {
    setVideos(next);
    if (!session || !userId || session.user_id !== userId) return;
    const supabase = createClient();
    const prevIds = new Set(videos.map((v) => v.id));
    const nextIds = new Set(next.map((v) => v.id));
    for (const video of next) {
      if (video.provider !== "youtube") continue;
      await upsertSessionVideo(supabase, session.id, userId, video);
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) {
        await deleteSessionVideo(supabase, id);
      }
    }
  }

  async function onExcludeChange(change: LapExcludeChange) {
    if (!session || !userId || session.user_id !== userId || excludeBusyId) {
      return;
    }
    const previous = laps;
    setExcludeError(null);
    setExcludeBusyId(change.lapId);
    setLaps((rows) =>
      rows.map((lap) =>
        lap.id === change.lapId
          ? {
              ...lap,
              excluded: change.excluded,
              exclude_reason: change.excluded
                ? (change.exclude_reason ?? "manual")
                : null,
            }
          : lap,
      ),
    );

    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${change.lapId}/exclude`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            excluded: change.excluded,
            exclude_reason: change.exclude_reason ?? null,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        excluded?: boolean;
        exclude_reason?: string | null;
      };

      if (response.ok) {
        setLaps((rows) =>
          rows.map((lap) =>
            lap.id === change.lapId
              ? {
                  ...lap,
                  excluded: Boolean(payload.excluded),
                  exclude_reason: payload.exclude_reason ?? null,
                }
              : lap,
          ),
        );
        return;
      }

      if (response.status === 401) {
        const supabase = createClient();
        const { data, error: updateError } = await supabase
          .from("laps")
          .update({
            excluded: change.excluded,
            exclude_reason: change.excluded
              ? (change.exclude_reason ?? "manual")
              : null,
          })
          .eq("id", change.lapId)
          .eq("session_id", session.id)
          .eq("user_id", userId)
          .select("id, excluded, exclude_reason")
          .maybeSingle();
        if (updateError) {
          setLaps(previous);
          setExcludeError(
            /excluded|exclude_reason/i.test(updateError.message)
              ? "Run supabase/migrations/20261019_exclude_bad_laps.sql in the Supabase SQL editor, then retry."
              : updateError.message,
          );
          return;
        }
        if (!data) {
          setLaps(previous);
          setExcludeError("Update blocked — are you the session owner?");
          return;
        }
        setLaps((rows) =>
          rows.map((lap) =>
            lap.id === change.lapId
              ? {
                  ...lap,
                  excluded: Boolean(data.excluded),
                  exclude_reason:
                    (data.exclude_reason as string | null) ?? null,
                }
              : lap,
          ),
        );
        return;
      }

      setLaps(previous);
      setExcludeError(
        payload.error ?? `Could not update lap (${response.status})`,
      );
    } catch (err) {
      setLaps(previous);
      setExcludeError(
        err instanceof Error ? err.message : "Could not update lap",
      );
    } finally {
      setExcludeBusyId(null);
    }
  }

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-500">Loading session…</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-400">
            {error && error !== "not-found"
              ? error
              : "Session not found, or it is private / friends-only."}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Public sessions open without an account.{" "}
            {!userId ? (
              <>
                <Link
                  href={`/login?next=${encodeURIComponent(`/sessions/${id}`)}`}
                  className="text-orange-400"
                >
                  Sign in
                </Link>{" "}
                only if this is a Friends or private session you own.
              </>
            ) : (
              "Ask the owner to set visibility to Public link to share."
            )}
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Browse public sessions
          </Link>
        </main>
      </>
    );
  }

  const best = bestLapTimeMs(laps);
  const coverage = videoCoverage(
    videos,
    laps.map((lap) => lap.id),
  );
  const dedicatedVideoLapIds = [...coverage.byLapId.keys()];
  const syncedLapIds = videos
    .filter(
      (v) =>
        v.syncSource === "manual" ||
        v.syncSource === "auto" ||
        v.syncSource === "time_of_day",
    )
    .flatMap((v) =>
      v.lapId
        ? [v.lapId]
        : v.syncSource === "manual" ||
            v.syncSource === "auto" ||
            v.syncSource === "time_of_day"
          ? ["__session__"]
          : [],
    );
  const href = compareHref(session.id, laps);
  const mine = Boolean(userId && session.user_id === userId);
  const visibility = normalizeVisibility(session.visibility ?? DEFAULT_VISIBILITY);
  const startedAtMs = session.started_at
    ? Date.parse(session.started_at)
    : undefined;

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Link
              href={mine ? "/account" : "/lap-comparisons?tab=sessions"}
              className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
            >
              {mine
                ? "My Sessions"
                : userId
                  ? "Friends"
                  : "Public feed"}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {session.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
              <span>
                {session.car ? `${session.car} · ` : ""}
                {laps.length} laps
                {best != null ? ` · best ${formatLapTime(best)}` : ""}
                {session.driver_name ? ` · ${session.driver_name}` : ""}
                {mine ? " · saved to your account" : ""}
                {!mine ? ` · ${visibility}` : ""}
              </span>
              <GpsQualityBadge
                quality={session.gps_quality}
                sourceKind={
                  session.source_kind === "gopro" ||
                  session.source_kind === "csv" ||
                  session.source_kind === "logger"
                    ? session.source_kind
                    : null
                }
              />
            </div>
          </div>
          {href ? (
            <Link
              href={href}
              className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
            >
              Compare laps
            </Link>
          ) : null}
        </div>

        {laps.length ? (
          <LapChips
            laps={laps}
            selectedId={selected?.id}
            onSelect={(lap) => selectLap(lap)}
            videoLapIds={dedicatedVideoLapIds}
            syncedLapIds={syncedLapIds}
            sessionVideo={Boolean(coverage.sessionLevel)}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="space-y-4 lg:sticky lg:top-20">
            {mine ? (
              <div className="space-y-2">
                <SessionVisibilityControl
                  value={visibility}
                  onChange={onVisibility}
                  disabled={visibilityBusy}
                />
                {visibilityBusy ? (
                  <p className="text-xs text-zinc-500">Saving visibility…</p>
                ) : null}
                {visibilityError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                  >
                    {visibilityError}
                  </p>
                ) : null}
                {excludeError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                  >
                    {excludeError}
                  </p>
                ) : null}
                {trimError ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                  >
                    {trimError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-600">
                Visibility · {visibility}
              </p>
            )}

            {laps.length ? (
              <LapList
                laps={laps}
                selectedId={selected?.id}
                onSelect={(lap) => selectLap(lap)}
                videoLapIds={dedicatedVideoLapIds}
                syncedLapIds={syncedLapIds}
                sessionVideo={Boolean(coverage.sessionLevel)}
                canEdit={mine}
                onExcludeChange={mine ? onExcludeChange : undefined}
                excludeBusyId={excludeBusyId}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                No laps in this session.
              </p>
            )}

            {(mine || videos.length > 0) && (
              <details
                open={videos.length === 0}
                className="group rounded-xl border border-zinc-800/80 bg-zinc-950/40"
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
                  Bulk YouTube / catalog
                  <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
                    per-lap sync on selected lap →
                  </span>
                </summary>
                <div className="border-t border-zinc-900 px-3 pb-3 pt-2">
                  <SessionVideosCard
                    session={{
                      id: session.id,
                      trackId: session.track_id ?? undefined,
                      sessionDate: session.session_date ?? undefined,
                      startedAtMs: Number.isFinite(startedAtMs)
                        ? startedAtMs
                        : undefined,
                      created_at: session.created_at,
                      laps: laps.map((lap) => ({
                        id: lap.id,
                        lap_number: lap.lap_number,
                        lap_time_ms: lap.lap_time_ms,
                      })),
                    }}
                    videos={videos}
                    onChange={mine ? onVideosChange : () => {}}
                    readOnly={!mine}
                  />
                </div>
              </details>
            )}
          </div>

          <div className="min-w-0">
            {selectedRow ? (
              <SessionLapDetail
                sessionId={session.id}
                lap={{
                  id: selectedRow.id,
                  lap_number: selectedRow.lap_number,
                  lap_time_ms: selectedRow.lap_time_ms,
                  start_offset_sec: selectedRow.start_offset_sec,
                  telemetry: (selectedRow.telemetry ?? []) as TelemetryPoint[],
                  excluded: selectedRow.excluded ?? false,
                  exclude_reason: selectedRow.exclude_reason ?? null,
                  start_offset_override:
                    selectedRow.start_offset_override ?? null,
                  end_offset_override: selectedRow.end_offset_override ?? null,
                }}
                siblingLaps={detailLaps}
                videos={videos}
                videoParam={videoParam}
                trackId={session.track_id}
                sessionStartedAtMs={
                  Number.isFinite(startedAtMs) ? startedAtMs : undefined
                }
                canEdit={mine}
                onExcludeChange={mine ? onExcludeChange : undefined}
                excludeBusy={excludeBusyId === selectedRow.id}
                onTrimChange={mine ? onTrimChange : undefined}
                onTrimReset={mine ? onTrimReset : undefined}
                onMergeNext={mine ? onMergeNext : undefined}
                onSplit={mine ? onSplit : undefined}
                trimBusy={trimBusy}
                onVideoChange={
                  mine
                    ? async (next) => {
                        setVideos((prev) => {
                          const exists = prev.some((v) => v.id === next.id);
                          return exists
                            ? prev.map((v) => (v.id === next.id ? next : v))
                            : [...prev, next];
                        });
                        try {
                          const supabase = createClient();
                          if (userId) {
                            await upsertSessionVideo(
                              supabase,
                              session.id,
                              userId,
                              next,
                            );
                          } else {
                            await updateSessionVideoSync(supabase, next);
                          }
                        } catch {
                          // keep local UI state
                        }
                      }
                    : undefined
                }
              />
            ) : laps.length ? (
              <p className="text-sm text-zinc-500">Select a lap to view.</p>
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}
