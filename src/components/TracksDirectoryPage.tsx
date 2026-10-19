"use client";

import { AppHeader } from "@/components/AppHeader";
import { SiteFooter } from "@/components/SiteFooter";
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
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return extra;
}

export function TracksDirectoryPage() {
  const [query, setQuery] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const extraTracks = useExtraTracks();
  const tracks = useMemo(
    () => popularTracks(query, extraTracks),
    [query, extraTracks],
  );

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setSignedIn(Boolean(data.user));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Tracks
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Open a track to upload or browse sessions.
            </p>
          </div>
          <Link
            href="/upload"
            className="inline-flex min-h-10 items-center rounded-lg border border-dashed border-zinc-700 px-4 text-xs uppercase tracking-[0.16em] text-zinc-400 hover:border-orange-500/50 hover:text-orange-300"
          >
            Add your track
          </Link>
        </div>

        <label className="flex max-w-md flex-col gap-1.5">
          <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Search
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Thunderhill, Buttonwillow…"
            className="min-h-11 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
        </label>

        {tracks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No tracks match that search.
          </p>
        ) : (
          <ul className="grid max-h-[min(70vh,720px)] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {tracks.map((track) => (
              <li key={track.id}>
                <Link
                  href={`/tracks/${track.id}`}
                  className="flex min-h-14 flex-col justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                >
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
                  <p className="mt-0.5 truncate text-xs text-zinc-500">
                    {track.location}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter signedIn={signedIn} />
    </>
  );
}
