"use client";

import { AppHeader } from "@/components/AppHeader";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { LapList } from "@/components/LapList";
import { SessionVideosCard } from "@/components/SessionVideosCard";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import type { GpsQuality } from "@/lib/gps-quality";
import {
  deleteSessionVideo,
  fetchSessionVideos,
  upsertSessionVideo,
} from "@/lib/session-videos-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, SessionVideo } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useState } from "react";

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

  const best = laps.reduce(
    (min, lap) => Math.min(min, lap.lap_time_ms),
    Number.POSITIVE_INFINITY,
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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Link
              href={mine ? "/account" : "/lap-comparisons?tab=sessions"}
              className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
            >
              {mine
                ? "Your account sessions"
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
                {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
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

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
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
              </div>
            ) : (
              <p className="text-xs uppercase tracking-[0.16em] text-zinc-600">
                Visibility · {visibility}
              </p>
            )}

            {(mine || videos.length > 0) && (
              <details open className="group rounded-xl border border-zinc-800/80 bg-zinc-950/40">
                <summary className="cursor-pointer list-none px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
                  YouTube onboard
                  <span className="ml-2 text-zinc-600 group-open:hidden">
                    show
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

          <div className="max-h-[min(70vh,720px)] overflow-y-auto pr-1">
            {laps.length ? (
              <LapList sessionId={session.id} laps={laps} />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                No laps in this session.
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
