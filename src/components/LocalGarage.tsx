"use client";

import { AttributionCard } from "@/components/Attribution";
import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { LapList } from "@/components/LapList";
import { LapCharts } from "@/components/LapCharts";
import { loadCatalogSession } from "@/lib/catalog";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { getLocalSession, type StoredSession } from "@/lib/local-store";
import { getTrack } from "@/lib/tracks";
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
      className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
    >
      Compare laps
    </Link>
  );
}

function LoadingShell({ label }: { label: string }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-zinc-500">{label}</p>
      </main>
    </>
  );
}

function MissingShell({ message }: { message: string }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-zinc-400">{message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
          Back to tracks
        </Link>
      </main>
    </>
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

  if (session === undefined) return <LoadingShell label="Loading comparison…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
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
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href={`/sessions/${session.id}`}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {session.name}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            Compare laps
          </h1>
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
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
      const frame = window.requestAnimationFrame(() => {
        if (!cancelled) setSession(local);
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
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

  if (session === undefined) return <LoadingShell label="Loading session…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
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

  const track = session.trackId ? getTrack(session.trackId) : null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href={track ? `/tracks/${track.id}` : "/"}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {track ? track.name : "All tracks"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {session.name}
          </h1>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {session.car ? `${session.car} · ` : ""}
              {session.laps.length} laps
              {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
            </p>
            <CompareLink sessionId={session.id} laps={laps} />
          </div>
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
          />
        </div>
        {laps.length ? (
          <LapList sessionId={session.id} laps={laps} />
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No laps in this session.
          </p>
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

  if (session === undefined) return <LoadingShell label="Loading lap…" />;
  if (!session || !lap) {
    return <MissingShell message="Lap not found in this browser." />;
  }

  const peak = lap.telemetry.reduce((max, point) => Math.max(max, point.speed), 0);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href={`/sessions/${session.id}`}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {session.name}
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                Lap {lap.lap_number}
              </h1>
              <p className="mt-1 font-mono text-3xl text-orange-400 sm:text-4xl">
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
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
        </div>
        {lap.telemetry.length ? (
          <LapCharts points={lap.telemetry} label={`Lap ${lap.lap_number}`} />
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No speed samples on this lap.
          </p>
        )}
      </main>
    </>
  );
}
