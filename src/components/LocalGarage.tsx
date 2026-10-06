"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { LapList } from "@/components/LapList";
import { SessionUpload } from "@/components/SessionUpload";
import { SpeedChart } from "@/components/SpeedChart";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { compareHref, hasGps } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import {
  getLocalSession,
  listLocalSessions,
  type StoredSession,
} from "@/lib/local-store";
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
        <AppHeader local />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Session not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to sessions
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
      <AppHeader local />
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
    setSession(getLocalSession(id));
  }, [id]);

  return session;
}

export function LocalHome() {
  const [sessions, setSessions] = useState<StoredSession[] | null>(null);

  useEffect(() => {
    setSessions(listLocalSessions());
  }, []);

  return (
    <>
      <AppHeader local />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Sessions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Saved in this browser until Supabase is connected. Load the sample
            to see laps, a GPS trace, and a lap comparison.
          </p>
        </div>
        <SessionUpload storage="local" />
        {sessions == null ? null : sessions.length === 0 ? (
          <p className="text-sm text-zinc-500">No sessions yet.</p>
        ) : (
          <ul className="grid gap-3">
            {sessions.map((session) => {
              const best = Math.min(...session.laps.map((lap) => lap.lap_time_ms));
              return (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                  >
                    <div>
                      <p className="font-medium text-zinc-100">{session.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {new Date(session.created_at).toLocaleString()}
                        {session.filename ? ` · ${session.filename}` : ""}
                      </p>
                    </div>
                    <p className="font-mono text-lg text-orange-400">
                      {Number.isFinite(best) ? formatLapTime(best) : "—"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

export function LocalSession({ id }: { id: string }) {
  const session = useLocalSession(id);

  if (session === undefined) return null;
  if (!session) {
    return (
      <>
        <AppHeader local />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Session not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to sessions
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
      <AppHeader local />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            All sessions
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            {session.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
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
        <AppHeader local />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Lap not found in this browser.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to sessions
          </Link>
        </main>
      </>
    );
  }

  const peak = lap.telemetry.reduce((max, point) => Math.max(max, point.speed), 0);

  return (
    <>
      <AppHeader local />
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
          <>
            {hasGps(lap.telemetry) ? (
              <TrackMap
                traces={[
                  {
                    id: lap.id,
                    label: `Lap ${lap.lap_number}`,
                    color: "#f97316",
                    points: lap.telemetry,
                    colorBySpeed: true,
                  },
                ]}
              />
            ) : (
              <MissingGps />
            )}
            <SpeedChart points={lap.telemetry} />
          </>
        ) : (
          <p className="text-sm text-zinc-500">No speed samples on this lap.</p>
        )}
      </main>
    </>
  );
}
