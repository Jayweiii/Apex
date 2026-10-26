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
      <main className="apex-page apex-page--medium">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Tracks
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Open a track to upload or browse sessions.
            </p>
          </div>
          <Link href="/upload" className="apex-btn apex-btn--accent">
            Add your track
          </Link>
        </div>

        <label className="flex max-w-md flex-col gap-1.5">
          <span className="apex-eyebrow">Search</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Thunderhill, Buttonwillow…"
            className="apex-field"
          />
        </label>

        {tracks.length === 0 ? (
          <p className="apex-empty">No tracks match that search.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tracks.map((track) => (
              <li key={track.id}>
                <Link
                  href={`/tracks/${track.id}`}
                  className="apex-pressable flex min-h-14 flex-col justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 hover:border-zinc-700 hover:bg-zinc-900/60"
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
