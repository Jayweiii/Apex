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
import { bestLapTimeMs } from "@/lib/lap-quality";
import { listLocalSessions, type StoredSession } from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  getTrack,
  listCustomTracks,
  listSharedTracksCache,
  popularTracks,
  resolveBuiltinAlias,
  trackEquivalentIds,
  setSharedTracksCache,
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
    .map((session) => {
      const best = bestLapTimeMs(session.laps);
      if (best == null) return null;
      return {
        id: session.id,
        name: session.name,
        car: session.car?.trim() || "Unknown",
        best,
        laps: session.laps.length,
        kind: (session.kind ?? "upload") as DataKind,
      };
    })
    .filter((row): row is TrackRow => row != null);
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

export function TrackHome() {
  const [query, setQuery] = useState("");
  const extraTracks = useExtraTracks();
  const tracks = useMemo(
    () => popularTracks(query, extraTracks),
    [query, extraTracks],
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6 sm:gap-10 sm:px-6 sm:py-10">
        <section className="flex flex-col gap-3">
          <p className="text-[11px] uppercase tracking-[0.22em] text-orange-400/90">
            Lap times · GPS · compare
          </p>
          <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
            Upload sessions and compare real laps
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
            Upload a CSV or GoPro — no account required. Guests save to the
            cloud (default Public link); add an email later to keep sessions
            across devices.
          </p>
        </section>

        <SessionUpload />

        <YourSessions />

        <PublicCloudSessions />

        <LeaderboardPanel />

        <label className="flex flex-col gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Search tracks
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Thunderhill, Buttonwillow…"
            className="min-h-12 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:text-sm"
          />
        </label>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-300">
            {query.trim() ? "Matching tracks" : "Tracks"}
          </h2>
          {tracks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
              No tracks match that search. Try “Thunderhill” or clear the filter.
            </p>
          ) : (
            <ul className="grid gap-3">
              {tracks.map((track) => {
                return (
                  <li key={track.id}>
                    <Link
                      href={`/tracks/${track.id}`}
                      className="flex min-h-16 items-center justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-zinc-100">
                          {track.name}
                          {track.id.startsWith("custom-") ? (
                            <span className="ml-2 text-xs font-normal text-zinc-500">
                              {track.location === "Added in this browser"
                                ? "this browser"
                                : "community"}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {track.location}
                          {" · upload your sessions"}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-lg text-orange-400">
                        —
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

function pickGpsLap(
  laps: Array<{ telemetry?: TelemetryPoint[] | null; lap_time_ms?: number }>,
): TelemetryPoint[] | null {
  const withGps = laps
    .map((lap) => lap.telemetry ?? [])
    .filter(
      (pts) =>
        pts.filter((p) => p.lat != null && p.lon != null).length >= 40,
    )
    .sort((a, b) => b.length - a.length);
  return withGps[0] ?? null;
}

/**
 * Prefer a real session GPS outline over the builtin ellipse placeholder.
 */
function overviewPointsForTrack(
  track: Track,
  local: StoredSession[] | null,
  cloudGps: TelemetryPoint[] | null,
): TelemetryPoint[] | null {
  if (cloudGps && cloudGps.length >= 40) return cloudGps;

  const localWithGps = (local ?? []).find((session) =>
    session.laps.some((lap) =>
      lap.telemetry.some((point) => point.lat != null && point.lon != null),
    ),
  );
  if (localWithGps) {
    const pts = pickGpsLap(localWithGps.laps);
    if (pts) return pts;
  }

  // Last resort only — ellipse is not the real track.
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
  const [cloudGps, setCloudGps] = useState<TelemetryPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) return;
      try {
        const supabase = createClient();
        const aliases = trackEquivalentIds(track.id);
        // Prefer accessible sessions (public + friends via RLS), not only public.
        let sessionsQuery = supabase
          .from("sessions")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(12);
        sessionsQuery =
          aliases.length > 1
            ? sessionsQuery.in("track_id", aliases)
            : sessionsQuery.eq("track_id", track.id);
        const { data: sessions } = await sessionsQuery;
        const ids = (sessions ?? []).map((row) => row.id as string);
        if (!ids.length || cancelled) return;

        // Pull telemetry one session at a time — bulk select can truncate/omit jsonb.
        for (const sessionId of ids) {
          if (cancelled) return;
          const { data: laps } = await supabase
            .from("laps")
            .select("telemetry, lap_time_ms")
            .eq("session_id", sessionId)
            .order("lap_number", { ascending: true })
            .limit(20);
          const pts = pickGpsLap(
            (laps ?? []).map((lap) => ({
              telemetry: (lap.telemetry ?? null) as TelemetryPoint[] | null,
              lap_time_ms: lap.lap_time_ms as number,
            })),
          );
          if (pts && pts.length >= 40) {
            setCloudGps(pts);
            return;
          }
        }
      } catch {
        // keep ellipse / local fallback
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [track.id]);

  const mapPoints = useMemo(
    () => overviewPointsForTrack(track, local, cloudGps),
    [track, local, cloudGps],
  );
  if (!mapPoints || mapPoints.length < 2) return null;

  return (
    <TrackMap
      compact
      hideCameraControls
      traces={[
        {
          id: `${track.id}-overview`,
          label: track.name,
          color: "#f97316",
          // Single polyline (not per-segment color) so the GPS outline is clear.
          points: mapPoints,
          colorBySpeed: false,
        },
      ]}
    />
  );
}

export function TrackDetail({ id }: { id: string }) {
  const [track, setTrack] = useState<Track | null>(() => getTrack(id));
  const [trackLoading, setTrackLoading] = useState(() => !getTrack(id));
  const [tab, setTab] = useState<"sessions" | "leaderboard" | "upload">(
    "sessions",
  );
  const local = useLocalSessions();
  // Warm sharedTracksCache so non-builtin community ids resolve after hydrate.
  useExtraTracks();

  useEffect(() => {
    let cancelled = false;
    async function resolve() {
      const direct = getTrack(id);
      if (direct) {
        if (!cancelled) {
          setTrack(direct);
          setTrackLoading(false);
        }
        return;
      }
      if (hasSupabaseConfig()) {
        try {
          const shared = await fetchSharedTracks(createClient());
          if (!cancelled) setSharedTracksCache(shared);
        } catch {
          // keep empty
        }
      }
      if (!cancelled) {
        setTrack(getTrack(id));
        setTrackLoading(false);
      }
    }
    const frame = window.requestAnimationFrame(() => {
      void resolve();
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
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-400">
            {trackLoading || local === null ? "Loading track…" : "Track not found."}
          </p>
          <Link href="/tracks" className="mt-4 inline-block text-sm text-orange-400">
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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link
              href="/tracks"
              className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
            >
              All tracks
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              {track.name}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{track.location}</p>
          </div>
          <div
            role="tablist"
            aria-label="Track sections"
            className="flex flex-wrap gap-2"
          >
            {(
              [
                { id: "sessions" as const, label: "Sessions" },
                { id: "leaderboard" as const, label: "Leaderboard" },
                { id: "upload" as const, label: "Upload" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={`apex-btn ${tab === item.id ? "apex-btn--pressed" : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "sessions" ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
            <div className="lg:sticky lg:top-20">
              <TrackOverviewMap track={track} local={local} />
            </div>
            <div className="flex flex-col gap-4">
              <PublicCloudSessions trackId={track.id} />
              {loading ? (
                <p className="text-sm text-zinc-500">Loading sessions…</p>
              ) : groups.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
                  No sessions saved in this browser — public cloud sessions for
                  this track appear above when available.
                </p>
              ) : (
                groups.map((group) => (
                  <section key={group.car} className="flex flex-col gap-2">
                    <h2 className="text-sm font-medium tracking-wide text-zinc-200">
                      {group.car}
                    </h2>
                    <ul className="grid gap-2">
                      {group.sessions.map((session) => (
                        <li key={session.id}>
                          <Link
                            href={`/sessions/${session.id}`}
                            className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                          >
                            <div className="min-w-0 space-y-1">
                              <p className="font-medium text-zinc-100">
                                {session.name}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                                <DataKindBadge kind={session.kind} />
                                <span>{session.laps} laps</span>
                              </div>
                            </div>
                            <p className="shrink-0 font-mono text-base text-orange-400">
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
          </div>
        ) : null}

        {tab === "leaderboard" ? (
          <LeaderboardPanel trackId={track.id} />
        ) : null}

        {tab === "upload" ? <SessionUpload trackId={track.id} /> : null}
      </main>
    </>
  );
}
