"use client";

import { AppHeader } from "@/components/AppHeader";
import { YOUTUBE_CATALOG, YOUTUBE_CHANNEL } from "@/lib/youtube-catalog";
import { getTrack } from "@/lib/tracks";
import { formatLapTime } from "@/lib/format";
import Link from "next/link";

export function YoutubeCatalogPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-orange-400/90">
            YouTube catalog
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            {YOUTUBE_CHANNEL.name} onboards
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Track videos from{" "}
            <a
              href={YOUTUBE_CHANNEL.url}
              className="text-orange-400 hover:text-orange-300"
              target="_blank"
              rel="noreferrer"
            >
              {YOUTUBE_CHANNEL.handle}
            </a>
            . Open a matching session to one-click attach and sync.
          </p>
        </div>
        <ul className="grid gap-3">
          {YOUTUBE_CATALOG.map((entry) => {
            const track = entry.trackId ? getTrack(entry.trackId) : null;
            return (
              <li
                key={entry.youtubeId}
                className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-100">{entry.title}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {track?.name ?? entry.trackId ?? "Unknown track"}
                      {entry.lapMs != null
                        ? ` · ${formatLapTime(entry.lapMs)}`
                        : ""}
                      {" · "}
                      {entry.uploadedAt}
                    </p>
                  </div>
                  <a
                    href={`https://youtu.be/${entry.youtubeId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs uppercase tracking-[0.16em] text-orange-400"
                  >
                    Watch
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-zinc-500">
          Regenerate with{" "}
          <code className="text-zinc-400">npx tsx scripts/import-youtube.ts</code>
          .{" "}
          <Link href="/" className="text-orange-400">
            Back to tracks
          </Link>
        </p>
      </main>
    </>
  );
}
