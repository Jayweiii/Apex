"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCharts } from "@/components/LapCharts";
import { SyncedLapView } from "@/components/video/SyncedLapView";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import {
  fetchSessionVideos,
  updateSessionVideoSync,
} from "@/lib/session-videos-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, SessionVideo, TelemetryPoint } from "@/lib/types";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type CloudSession = {
  id: string;
  name: string;
  track_id?: string | null;
  started_at?: string | null;
  user_id?: string;
};

/**
 * Browser-auth lap view for cloud session UUIDs — YouTube sync when attached.
 */
export function CloudLapView({
  sessionId,
  lapId,
}: {
  sessionId: string;
  lapId: string;
}) {
  const searchParams = useSearchParams();
  const videoParam = searchParams.get("v");
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<CloudSession | null | undefined>(
    undefined,
  );
  const [lap, setLap] = useState<LapRow | null>(null);
  const [siblings, setSiblings] = useState<LapRow[]>([]);
  const [videos, setVideos] = useState<SessionVideo[]>([]);
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

        const { data: row, error: sessionError } = await supabase
          .from("sessions")
          .select("id, name, track_id, started_at, user_id")
          .eq("id", sessionId)
          .maybeSingle();
        if (cancelled) return;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          return;
        }
        if (!row) {
          setSession(null);
          setError("not-found");
          return;
        }
        setSession(row as CloudSession);

        const { data: lapRows } = await supabase
          .from("laps")
          .select("*")
          .eq("session_id", sessionId)
          .order("lap_number", { ascending: true });
        if (cancelled) return;
        const all = (lapRows ?? []) as LapRow[];
        setSiblings(all);
        const found = all.find((item) => item.id === lapId) ?? null;
        if (!found) {
          setLap(null);
          setError("not-found");
          return;
        }
        setLap(found);

        let cloudVideos: SessionVideo[] = [];
        try {
          cloudVideos = await fetchSessionVideos(supabase, sessionId);
        } catch {
          cloudVideos = [];
        }
        if (!cancelled) {
          setVideos(
            cloudVideos.filter((v) => v.provider === "youtube" && v.youtubeId),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load lap");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, lapId]);

  const activeVideo: SessionVideo | null = useMemo(() => {
    if (!videos.length) return null;
    return (
      videos.find((item) => item.id === videoParam) ??
      videos.find((item) => item.lapId === lapId) ??
      videos[0] ??
      null
    );
  }, [videos, videoParam, lapId]);

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-500">Loading lap…</p>
        </main>
      </>
    );
  }

  if (!session || !lap) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-400">
            {error === "not-found" || !error
              ? "Lap not found, or the session is private / friends-only."
              : error}
          </p>
          {!userId ? (
            <p className="mt-2 text-sm text-zinc-500">
              Public laps open without an account.{" "}
              <Link
                href={`/login?next=${encodeURIComponent(`/sessions/${sessionId}/laps/${lapId}`)}`}
                className="text-orange-400"
              >
                Sign in
              </Link>{" "}
              only for Friends or private access.
            </p>
          ) : null}
          <Link
            href={`/sessions/${sessionId}`}
            className="mt-4 inline-block text-sm text-orange-400"
          >
            Back to session
          </Link>
        </main>
      </>
    );
  }

  const points = (lap.telemetry ?? []) as TelemetryPoint[];
  const peak = points.reduce((max, point) => Math.max(max, point.speed), 0);
  const href = compareHref(
    session.id,
    siblings.map((s) => ({ id: s.id, lap_time_ms: s.lap_time_ms })),
    lap.id,
  );
  const bestMs = Math.min(...siblings.map((s) => s.lap_time_ms));
  const startedAtMs = session.started_at
    ? Date.parse(session.started_at)
    : undefined;
  const mine = Boolean(userId && session.user_id === userId);
  const showSynced = Boolean(activeVideo);

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
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                Lap {lap.lap_number}
              </h1>
              <p className="mt-1 font-mono text-3xl text-orange-400">
                {formatLapTime(lap.lap_time_ms)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <p className="text-sm text-zinc-500">Peak {peak.toFixed(0)} km/h</p>
              {href ? (
                <Link
                  href={href}
                  className="text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
                >
                  Compare laps
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {points.length ? (
          showSynced ? (
            <SyncedLapView
              sessionId={session.id}
              lap={{
                id: lap.id,
                lap_number: lap.lap_number,
                lap_time_ms: lap.lap_time_ms,
                start_offset_sec: lap.start_offset_sec ?? undefined,
                telemetry: points,
              }}
              siblingLaps={siblings.map((item) => ({
                id: item.id,
                lap_number: item.lap_number,
                lap_time_ms: item.lap_time_ms,
                start_offset_sec: item.start_offset_sec ?? undefined,
                telemetry: (item.telemetry ?? []) as TelemetryPoint[],
              }))}
              video={activeVideo}
              sessionStartedAtMs={
                Number.isFinite(startedAtMs) ? startedAtMs : undefined
              }
              bestLapMs={bestMs}
              trackId={session.track_id}
              onVideoChange={
                mine && activeVideo
                  ? async (next) => {
                      setVideos((prev) =>
                        prev.map((v) => (v.id === next.id ? next : v)),
                      );
                      try {
                        const supabase = createClient();
                        await updateSessionVideoSync(supabase, next);
                      } catch {
                        // keep local UI state
                      }
                    }
                  : undefined
              }
            />
          ) : (
            <LapCharts
              points={points}
              label={`Lap ${lap.lap_number}`}
              trackId={session.track_id}
            />
          )
        ) : (
          <p className="text-sm text-zinc-500">No speed samples on this lap.</p>
        )}
      </main>
    </>
  );
}
