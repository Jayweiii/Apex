"use client";

import { fetchSharedTracks } from "@/lib/cloud-tracks";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  listCustomTracks,
  listSharedTracksCache,
  popularTracks,
  setSharedTracksCache,
  type Track,
} from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type TrackCount = { track: Track; sessions: number };

export function HomeTracksColumn() {
  const [extra, setExtra] = useState<Track[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const local = listCustomTracks();
      let shared = listSharedTracksCache();
      if (hasSupabaseConfig()) {
        try {
          const supabase = createClient();
          shared = await fetchSharedTracks(supabase);
          if (!cancelled) setSharedTracksCache(shared);

          const { data } = await supabase
            .from("sessions")
            .select("track_id")
            .not("track_id", "is", null)
            .limit(500);
          if (!cancelled && data) {
            const map = new Map<string, number>();
            for (const row of data) {
              const id = row.track_id as string;
              if (!id) continue;
              map.set(id, (map.get(id) ?? 0) + 1);
            }
            setCounts(map);
          }
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
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: TrackCount[] = useMemo(() => {
    const tracks = popularTracks("", extra);
    return tracks
      .map((track) => ({
        track,
        sessions: counts.get(track.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.sessions - a.sessions || a.track.name.localeCompare(b.track.name),
      )
      .slice(0, 8);
  }, [extra, counts]);

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-2">
        {rows.map(({ track, sessions }) => (
          <li key={track.id}>
            <Link
              href={`/tracks/${track.id}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-3 py-2.5 transition hover:border-zinc-600"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  {track.name}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {track.location}
                </p>
              </div>
              <p className="shrink-0 font-mono text-xs text-zinc-400">
                {sessions}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/upload"
        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-dashed border-zinc-700 px-3 text-xs uppercase tracking-[0.16em] text-zinc-400 transition hover:border-orange-500/50 hover:text-orange-300"
      >
        Add your track
      </Link>
      <Link
        href="/tracks"
        className="text-center text-[11px] uppercase tracking-[0.16em] text-zinc-600 hover:text-zinc-400"
      >
        All tracks
      </Link>
    </div>
  );
}
