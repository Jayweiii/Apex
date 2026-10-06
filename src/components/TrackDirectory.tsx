"use client";

import { AppHeader } from "@/components/AppHeader";
import { SessionUpload } from "@/components/SessionUpload";
import {
  catalogBestMs,
  catalogSessionsForTrack,
  type CatalogSession,
} from "@/lib/catalog";
import { formatLapTime } from "@/lib/format";
import { listLocalSessions, type StoredSession } from "@/lib/local-store";
import { getTrack, popularTracks } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TrackRow = {
  id: string;
  name: string;
  car: string;
  best: number;
  laps: number;
  source: "catalog" | "browser";
};

function rowsForTrack(trackId: string, local: StoredSession[]): TrackRow[] {
  const catalog: TrackRow[] = catalogSessionsForTrack(trackId).map(
    (session: CatalogSession) => ({
      id: session.id,
      name: session.name,
      car: session.car,
      best: catalogBestMs(session),
      laps: 3,
      source: "catalog",
    }),
  );
  const browser: TrackRow[] = local
    .filter((session) => session.trackId === trackId)
    .map((session) => ({
      id: session.id,
      name: session.name,
      car: session.car?.trim() || "Unknown",
      best: Math.min(...session.laps.map((lap) => lap.lap_time_ms)),
      laps: session.laps.length,
      source: "browser",
    }));
  return [...catalog, ...browser];
}

function groupByCar(rows: TrackRow[]) {
  const groups = new Map<string, TrackRow[]>();
  for (const row of rows) {
    const list = groups.get(row.car) ?? [];
    list.push(row);
    groups.set(row.car, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([car, sessions]) => ({
      car,
      sessions: sessions.sort((a, b) => a.best - b.best || a.name.localeCompare(b.name)),
    }));
}

export function TrackHome() {
  const [query, setQuery] = useState("");
  const tracks = useMemo(() => popularTracks(query), [query]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Tracks
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Open a circuit to compare laps by car. No account needed.
          </p>
        </div>
        <SessionUpload storage="local" />
        <label className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Search tracks
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Laguna Seca, Spa, Austin…"
            className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
        </label>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-300">
            {query.trim() ? "Matching tracks" : "Popular tracks"}
          </h2>
          {tracks.length === 0 ? (
            <p className="text-sm text-zinc-500">No tracks match that search.</p>
          ) : (
            <ul className="grid gap-3">
              {tracks.map((track) => {
                const best = Math.min(
                  ...catalogSessionsForTrack(track.id).map((session) =>
                    catalogBestMs(session),
                  ),
                );
                return (
                  <li key={track.id}>
                    <Link
                      href={`/tracks/${track.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                    >
                      <div>
                        <p className="font-medium text-zinc-100">{track.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {track.location}
                          {" · "}
                          {track.popularity.toLocaleString()} sessions
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
        </section>
      </main>
    </>
  );
}

export function TrackDetail({ id }: { id: string }) {
  const track = getTrack(id);
  const [local, setLocal] = useState<StoredSession[] | null>(null);

  useEffect(() => {
    setLocal(listLocalSessions());
  }, []);

  if (!track) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="text-sm text-zinc-400">Track not found.</p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to tracks
          </Link>
        </main>
      </>
    );
  }

  const groups = groupByCar(rowsForTrack(track.id, local ?? []));

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            All tracks
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            {track.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            {track.location}
            {" · "}
            {track.popularity.toLocaleString()} sessions
            {" · sorted by car"}
          </p>
        </div>
        <SessionUpload storage="local" trackId={track.id} />
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <section key={group.car} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium tracking-wide text-zinc-200">
                {group.car}
              </h2>
              <ul className="grid gap-2">
                {group.sessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={`/sessions/${session.id}`}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                    >
                      <div>
                        <p className="font-medium text-zinc-100">{session.name}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {session.laps} laps
                          {session.source === "browser" ? " · this browser" : ""}
                        </p>
                      </div>
                      <p className="font-mono text-lg text-orange-400">
                        {Number.isFinite(session.best) ? formatLapTime(session.best) : "—"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}
