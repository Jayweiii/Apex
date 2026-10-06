"use client";

import { AppHeader } from "@/components/AppHeader";
import { SessionUpload } from "@/components/SessionUpload";
import {
  listAccountSessions,
  type AccountSessionSummary,
} from "@/lib/account-sessions";
import {
  catalogBestMs,
  catalogSessionsForTrack,
  type CatalogSession,
} from "@/lib/catalog";
import { formatLapTime } from "@/lib/format";
import { listLocalSessions, type StoredSession } from "@/lib/local-store";
import {
  builtinTrack,
  getTrack,
  listCustomTracks,
  popularTracks,
  type Track,
} from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TrackRow = {
  id: string;
  name: string;
  car: string;
  best: number;
  laps: number;
  source: "catalog" | "browser" | "account";
};

function rowsForTrack(
  trackId: string,
  local: StoredSession[],
  account: AccountSessionSummary[],
): TrackRow[] {
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
  const saved: TrackRow[] = account
    .filter((session) => session.trackId === trackId)
    .map((session) => ({
      id: session.id,
      name: session.name,
      car: session.car,
      best: session.best,
      laps: session.laps,
      source: "account",
    }));
  return [...catalog, ...browser, ...saved];
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
  const [customTracks, setCustomTracks] = useState<Track[]>([]);
  const [localSessions, setLocalSessions] = useState<StoredSession[]>([]);
  const [accountSessions, setAccountSessions] = useState<AccountSessionSummary[]>([]);
  const tracks = useMemo(
    () => popularTracks(query, customTracks),
    [query, customTracks],
  );

  useEffect(() => {
    const local = listLocalSessions();
    setLocalSessions(local);
    let cancelled = false;
    listAccountSessions().then((account) => {
      if (cancelled) return;
      setAccountSessions(account);
      const extras = listCustomTracks();
      for (const session of account) {
        if (!session.trackId || builtinTrack(session.trackId)) continue;
        if (extras.some((track) => track.id === session.trackId)) continue;
        extras.push({
          id: session.trackId,
          name: session.trackName,
          location: "Your account",
          popularity: 0,
          lat: 0,
          lon: 0,
          search: session.trackName,
        });
      }
      setCustomTracks(extras);
    });
    setCustomTracks(listCustomTracks());
    return () => {
      cancelled = true;
    };
  }, []);

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
        <SessionUpload />
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
                const mine = localSessions.filter(
                  (session) => session.trackId === track.id,
                );
                const saved = accountSessions.filter(
                  (session) => session.trackId === track.id,
                );
                const times = [
                  ...catalogSessionsForTrack(track.id).map((session) =>
                    catalogBestMs(session),
                  ),
                  ...mine.flatMap((session) =>
                    session.laps.map((lap) => lap.lap_time_ms),
                  ),
                  ...saved.map((session) => session.best),
                ];
                const best = times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
                const sessions = track.id.startsWith("custom-")
                  ? mine.length + saved.length
                  : track.popularity;
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
                          {sessions === 1
                            ? "1 session"
                            : `${sessions.toLocaleString()} sessions`}
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
  const known = builtinTrack(id);
  const [track, setTrack] = useState<Track | null>(known);
  const [checked, setChecked] = useState(Boolean(known));
  const [local, setLocal] = useState<StoredSession[] | null>(null);
  const [account, setAccount] = useState<AccountSessionSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLocal(listLocalSessions());
    listAccountSessions().then((sessions) => {
      if (cancelled) return;
      const here = sessions.filter((session) => session.trackId === id);
      setAccount(here);
      const knownTrack = getTrack(id);
      if (knownTrack) {
        setTrack(knownTrack);
      } else if (here[0]) {
        setTrack({
          id,
          name: here[0].trackName,
          location: "Your account",
          popularity: 0,
          lat: 0,
          lon: 0,
          search: here[0].trackName,
        });
      } else {
        setTrack(null);
      }
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!checked) return null;

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

  const rows = rowsForTrack(track.id, local ?? [], account);
  const groups = groupByCar(rows);
  const listed = track.id.startsWith("custom-") ? rows.length : track.popularity;

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
            {listed === 1 ? "1 session" : `${listed.toLocaleString()} sessions`}
            {" · sorted by car"}
          </p>
        </div>
        <SessionUpload trackId={track.id} />
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
                          {session.source === "account" ? " · your account" : ""}
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
