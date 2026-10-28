"use client";

import { AppHeader } from "@/components/AppHeader";
import { fetchSharedTracks } from "@/lib/cloud-tracks";
import {
  DRIVE_CARS,
  loadSelectedCarId,
  saveSelectedCarId,
  type DriveCarId,
} from "@/lib/drive/cars";
import {
  loadGameLeaderboard,
  loadPersonalBest,
  type DriveLeaderboardEntry,
} from "@/lib/drive/scores";
import { formatLapTime } from "@/lib/format";
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

function readLocalBoards(trackIds: string[]) {
  const next: Record<
    string,
    { pb: number | null; top: DriveLeaderboardEntry[] }
  > = {};
  for (const id of trackIds) {
    next[id] = {
      pb: loadPersonalBest(id),
      top: loadGameLeaderboard(id).slice(0, 3),
    };
  }
  return next;
}

export function DriveHub() {
  const [extra, setExtra] = useState<Track[]>([]);
  const [carId, setCarId] = useState<DriveCarId>(() => loadSelectedCarId());
  const [boardTick, setBoardTick] = useState(0);

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
      if (!cancelled) {
        setExtra([...shared, ...local]);
        setBoardTick((n) => n + 1);
      }
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

  const boards = useMemo(() => {
    void boardTick;
    return readLocalBoards(tracks.map((t) => t.id));
  }, [tracks, boardTick]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-orange-400/90">
            Arcade
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            Drive
          </h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            Pick a car and a GPS track. Lap timing, PB ghost, sectors, and a
            local game board — never mixed with real session leaderboards.
          </p>
        </div>

        <section data-apex-drive-car-select className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">Car</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {DRIVE_CARS.map((car) => {
              const selected = car.id === carId;
              return (
                <li key={car.id}>
                  <button
                    type="button"
                    data-apex-drive-car={car.id}
                    aria-pressed={selected}
                    onClick={() => {
                      setCarId(car.id);
                      saveSelectedCarId(car.id);
                    }}
                    className={`flex w-full flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition ${
                      selected
                        ? "border-orange-500/50 bg-orange-500/10"
                        : "border-zinc-800/80 bg-zinc-950/50 hover:border-zinc-700"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-medium text-zinc-100">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ background: car.color }}
                        aria-hidden
                      />
                      {car.name}
                    </span>
                    <span className="text-xs text-zinc-500">{car.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">Track</h2>
          <ul className="grid gap-2">
            {tracks.map((track) => {
              const board = boards[track.id];
              return (
                <li key={track.id}>
                  <Link
                    href={`/drive/${track.id}?car=${carId}`}
                    data-apex-drive-track={track.id}
                    className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-100">{track.name}</p>
                      <p className="text-xs text-zinc-500">{track.location}</p>
                      {board?.pb != null || (board?.top.length ?? 0) > 0 ? (
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Local PB{" "}
                          {board?.pb != null ? formatLapTime(board.pb) : "—"}
                          {board?.top?.[0]
                            ? ` · board ${formatLapTime(board.top[0].timeMs)}`
                            : ""}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-sm text-orange-400">
                      Drive →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <p className="text-[11px] text-zinc-600">
          Local game boards are stored in this browser only under{" "}
          <code className="text-zinc-500">apex.drive.*</code> and never feed
          real lap leaderboards.
        </p>
      </main>
    </>
  );
}
