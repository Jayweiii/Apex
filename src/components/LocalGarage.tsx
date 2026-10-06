"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { LapList } from "@/components/LapList";
import { LapCharts } from "@/components/LapCharts";
import { loadCatalogSession } from "@/lib/catalog";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { getLocalSession, type StoredSession } from "@/lib/local-store";
import { builtinTrack, getTrack, type Track } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useState } from "react";

function CompareLink({
  sessionId,
  laps,
  focusId,
}: {
  sessionId: string;
  laps: { id: string; lap_time_ms: number }[];
  focusId?: string;
}) {
  const href = compareHref(sessionId, laps, focusId);
  if (!href) return null;
  return (
    <Link
      href={href}
      className="text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
    >
      Compare laps
    </Link>
  );
}

export function LocalCompare({
  id,
  initialRef,
  initialOther,
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
}) {
  const session = useLocalSession(id);

  if (session === undefined) return null;
  if (!session) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Session not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to tracks
          </Link>
        </main>
      </>
    );
  }

  const laps = session.laps.map((lap) => ({
    id: lap.id,
    session_id: session.id,
    user_id: "local",
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    telemetry: lap.telemetry,
  }));

  return (
    <>
      <AppHeader />
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
        </div>
        <LapCompare laps={laps} initialRef={initialRef} initialOther={initialOther} />
      </main>
    </>
  );
}

function useLocalSession(id: string) {
  const [session, setSession] = useState<StoredSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    const local = getLocalSession(id);
    if (local) {
      setSession(local);
      return;
    }
    loadCatalogSession(id)
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return session;
}

export function LocalSession({ id }: { id: string }) {
  const session = useLocalSession(id);
  const trackId = session?.trackId;
  const builtin = trackId ? builtinTrack(trackId) : null;
  const [customTrack, setCustomTrack] = useState<Track | null>(null);
  useEffect(() => {
    if (!trackId || builtin) {
      setCustomTrack(null);
      return;
    }
    setCustomTrack(getTrack(trackId));
  }, [trackId, builtin]);
  const track = builtin ?? customTrack;

  if (session === undefined) return null;
  if (!session) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Session not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to tracks
          </Link>
        </main>
      </>
    );
  }

  const best = session.laps.reduce(
    (min, lap) => Math.min(min, lap.lap_time_ms),
    Number.POSITIVE_INFINITY,
  );
  const laps = session.laps.map((lap) => ({
    id: lap.id,
    session_id: session.id,
    user_id: "local",
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    telemetry: lap.telemetry,
  }));

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href={track ? `/tracks/${track.id}` : "/"}
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {track ? track.name : "All tracks"}
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            {session.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {session.car ? `${session.car} · ` : ""}
              {session.laps.length} laps
              {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
            </p>
            <CompareLink sessionId={session.id} laps={laps} />
          </div>
        </div>
        {laps.length ? (
          <LapList sessionId={session.id} laps={laps} />
        ) : (
          <p className="text-sm text-zinc-500">No laps in this session.</p>
        )}
      </main>
    </>
  );
}

export function LocalLap({
  sessionId,
  lapId,
}: {
  sessionId: string;
  lapId: string;
}) {
  const session = useLocalSession(sessionId);
  const lap = session?.laps.find((item) => item.id === lapId);

  if (session === undefined) return null;
  if (!session || !lap) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Lap not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to tracks
          </Link>
        </main>
      </>
    );
  }

  const peak = lap.telemetry.reduce((max, point) => Math.max(max, point.speed), 0);

  return (
    <>
      <AppHeader />
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
              <CompareLink
                sessionId={session.id}
                laps={session.laps.map((item) => ({
                  id: item.id,
                  lap_time_ms: item.lap_time_ms,
                }))}
                focusId={lap.id}
              />
            </div>
          </div>
        </div>
        {lap.telemetry.length ? (
          <LapCharts points={lap.telemetry} label={`Lap ${lap.lap_number}`} />
        ) : (
          <p className="text-sm text-zinc-500">No speed samples on this lap.</p>
        )}
      </main>
    </>
  );
}
