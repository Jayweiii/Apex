"use client";

import { LeaderboardPanel } from "@/components/LeaderboardPanel";
import { DataKindBadge } from "@/components/Attribution";
import { AppHeader } from "@/components/AppHeader";
import { SessionUpload } from "@/components/SessionUpload";
import { PublicCloudSessions } from "@/components/PublicCloudSessions";
import { TrackMap } from "@/components/TrackMap";
import { YourSessions } from "@/components/YourSessions";
import { builtinCenterline } from "@/lib/centerlines";
import { fetchSharedTracks } from "@/lib/cloud-tracks";
import { formatLapTime } from "@/lib/format";
import { listLocalSessions, type StoredSession } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  getTrack,
  listCustomTracks,
  listSharedTracksCache,
  popularTracks,
  resolveBuiltinAlias,
  resolveCanonicalTrack,
  setSharedTracksCache,
  trackEquivalentIds,
  type Track,
} from "@/lib/tracks";
import type { DataKind } from "@/lib/attribution";
import type { TelemetryPoint } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TrackRow = {
  id: string;
  name: string;
  car: string;
  best: number;
  laps: number;
  kind: DataKind;
};

function rowsForTrack(trackId: string, local: StoredSession[]): TrackRow[] {
  const aliases = new Set(trackEquivalentIds(trackId));
  return local
    .filter(
      (session) =>
        session.trackId != null &&
        (aliases.has(session.trackId) || session.trackId === trackId),
    )
    .map((session) => ({
      id: session.id,
      name: session.name,
      car: session.car?.trim() || "Unknown",
      best: Math.min(...session.laps.map((lap) => lap.lap_time_ms)),
      laps: session.laps.length,
      kind: (session.kind ?? "upload") as DataKind,
    }));
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

function useLocalSessions() {
  const [local, setLocal] = useState<StoredSession[] | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setLocal(listLocalSessions());
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return local;
}

function useExtraTracks() {
  const [extra, setExtra] = useState<Track[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const local = listCustomTracks();
      let shared = listSharedTracksCache();
      if (hasSupabaseConfig()) {
        try {
          shared = await fetchSharedTracks(createClient());
          if (!cancelled) setSharedTracksCache(shared);
        } catch {
          // keep local
        }
      }
      if (cancelled) return;
      const merged: Track[] = [];
      for (const track of [...shared, ...local]) {
        if (!merged.some((item) => item.id === track.id)) merged.push(track);
      }
      setExtra(merged);
    }
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return extra;
}

/** @deprecated Home is HomeLanding; keep export for any leftover imports. */
export function TrackHome() {
  return null;
}

function overviewPointsForTrack(
  track: Track,
  local: StoredSession[] | null,
): TelemetryPoint[] | null {
  const centerline =
    builtinCenterline(track.id) ??
    builtinCenterline(resolveBuiltinAlias(track.id));
  if (centerline) {
    return centerline.map((point, index) => ({
      t: index,
      speed: 120,
      lat: point.lat,
      lon: point.lon,
    }));
  }
  const localWithGps = (local ?? []).find((session) =>
    session.laps.some((lap) =>
      lap.telemetry.some((point) => point.lat != null && point.lon != null),
    ),
  );
  if (localWithGps) {
    const lap =
      localWithGps.laps.find((item) =>
        item.telemetry.some((point) => point.lat != null && point.lon != null),
      ) ?? localWithGps.laps[0];
    return lap?.telemetry ?? null;
  }
  if (track.lat && track.lon) {
    return [
      { t: 0, speed: 0, lat: track.lat, lon: track.lon },
      {
        t: 1,
        speed: 0,
        lat: track.lat + 0.002,
        lon: track.lon + 0.002,
      },
    ];
  }
  return null;
}

function TrackOverviewMap({
  track,
  local,
}: {
  track: Track;
  local: StoredSession[] | null;
}) {
  const mapPoints = useMemo(
    () => overviewPointsForTrack(track, local),
    [track, local],
  );
  const centerline =
    builtinCenterline(track.id) ??
    builtinCenterline(resolveBuiltinAlias(track.id));
  if (!mapPoints || mapPoints.length < 2) return null;

  return (
    <TrackMap
      traces={[
        {
          id: `${track.id}-overview`,
          label: track.name,
          color: "#f97316",
          points: mapPoints,
          colorBySpeed: true,
        },
      ]}
      centerline={centerline}
    />
  );
}

export function TrackDetail({ id }: { id: string }) {
  const [track, setTrack] = useState<Track | null>(
    () => resolveCanonicalTrack(id) ?? getTrack(id),
  );
  const local = useLocalSessions();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (hasSupabaseConfig()) {
        try {
          const shared = await fetchSharedTracks(createClient());
          if (!cancelled) setSharedTracksCache(shared);
        } catch {
          // keep cache
        }
      }
      if (cancelled) return;
      setTrack(resolveCanonicalTrack(id) ?? getTrack(id));
    }
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [id]);

  if (!track) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-400">
            {local === null ? "Loading track…" : "Track not found."}
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Back to tracks
          </Link>
        </main>
      </>
    );
  }

  const groups = groupByCar(rowsForTrack(track.id, local ?? []));
  const loading = local === null;

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <Link
            href="/"
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            All tracks
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {track.name}
          </h1>
          <p className="mt-1 text-sm text-zinc-500">{track.location}</p>
        </div>
        <TrackOverviewMap track={track} local={local} />
        <SessionUpload trackId={track.id} />
        <LeaderboardPanel trackId={track.id} />
        <PublicCloudSessions trackId={track.id} />
        <div className="flex flex-col gap-6">
          {loading ? (
            <p className="text-sm text-zinc-500">Loading sessions…</p>
          ) : groups.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
              No sessions yet, upload one.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.car} className="flex flex-col gap-3">
                <h2 className="text-sm font-medium tracking-wide text-zinc-200">
                  {group.car}
                </h2>
                <ul className="grid gap-2">
                  {group.sessions.map((session) => (
                    <li key={session.id}>
                      <Link
                        href={`/sessions/${session.id}`}
                        className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:px-5"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <p className="font-medium text-zinc-100">{session.name}</p>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                            <DataKindBadge kind={session.kind} />
                            <span>{session.laps} laps</span>
                          </div>
                        </div>
                        <p className="shrink-0 font-mono text-lg text-orange-400">
                          {Number.isFinite(session.best)
                            ? formatLapTime(session.best)
                            : "—"}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </main>
    </>
  );
}
