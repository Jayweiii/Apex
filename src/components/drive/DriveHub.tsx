"use client";

import { AppHeader } from "@/components/AppHeader";
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

const SUGGESTED = [
  "thunderhill-west",
  "thunderhill-east",
  "custom-thunderhill-west",
  "custom-thunderhill-east",
];

export function DriveHub() {
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
          // keep cache
        }
      }
      if (!cancelled) setExtra([...shared, ...local]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const tracks = useMemo(() => {
    const all = popularTracks("", extra);
    const preferred = all.filter((t) =>
      SUGGESTED.some(
        (id) =>
          t.id === id ||
          t.id.includes("thunderhill") ||
          t.name.toLowerCase().includes("thunderhill"),
      ),
    );
    const rest = all.filter((t) => !preferred.includes(t));
    return [...preferred, ...rest].slice(0, 24);
  }, [extra]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-orange-400/90">
            Arcade
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            Drive
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Pick a track with GPS. You get a ribbon from a real session line,
            lap timing at the saved start/finish, and a ghost of your best —
            game times stay on a separate local board.
          </p>
        </div>
        <ul className="grid gap-2">
          {tracks.map((track) => (
            <li key={track.id}>
              <Link
                href={`/drive/${track.id}`}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <p className="font-medium text-zinc-100">{track.name}</p>
                  <p className="text-xs text-zinc-500">{track.location}</p>
                </div>
                <span className="shrink-0 text-sm text-orange-400">Drive →</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
