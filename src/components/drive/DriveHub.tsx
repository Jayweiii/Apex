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
import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

const SUGGESTED = [
  "thunderhill-west",
  "thunderhill-east",
  "custom-thunderhill-west",
  "custom-thunderhill-east",
];

const TRACK_KEY = "apex.drive.selectedTrack";

function loadSelectedTrackId(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(TRACK_KEY);
    if (raw) return raw;
  } catch {
    // ignore
  }
  return fallback;
}

function saveSelectedTrackId(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(TRACK_KEY, id);
  } catch {
    // ignore
  }
}

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

/** iPhone: stopPropagation on pointerdown so neighboring cards don't steal the tap. */
function selectOnActivate(
  event: MouseEvent | PointerEvent,
  select: () => void,
) {
  event.preventDefault();
  event.stopPropagation();
  select();
}

export function DriveHub() {
  const [extra, setExtra] = useState<Track[]>([]);
  const [carId, setCarId] = useState<DriveCarId>(() => loadSelectedCarId());
  const [trackId, setTrackId] = useState<string>(() =>
    loadSelectedTrackId("thunderhill-west"),
  );
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

  // Resolve against hydrated list without an effect (invalid ids fall back).
  const resolvedTrackId =
    tracks.length === 0
      ? trackId
      : tracks.some((t) => t.id === trackId)
        ? trackId
        : tracks[0]!.id;
  const selectedTrack =
    tracks.find((t) => t.id === resolvedTrackId) ?? tracks[0] ?? null;

  return (
    <>
      <AppHeader />
      <main
        data-apex-drive-car-track-select="1"
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"
      >
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
          <h2 id="apex-drive-car-label" className="text-sm font-medium text-zinc-200">
            Car
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="apex-drive-car-label"
            className="grid gap-2 sm:grid-cols-2"
          >
            {DRIVE_CARS.map((car) => {
              const selected = car.id === carId;
              return (
                <button
                  key={car.id}
                  type="button"
                  role="radio"
                  data-apex-drive-car={car.id}
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    selectOnActivate(event, () => {
                      setCarId(car.id);
                      saveSelectedCarId(car.id);
                    });
                  }}
                  style={{ touchAction: "manipulation" }}
                  className={`flex min-h-14 w-full flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition ${
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
              );
            })}
          </div>
        </section>

        <section data-apex-drive-track-select className="space-y-3">
          <h2
            id="apex-drive-track-label"
            className="text-sm font-medium text-zinc-200"
          >
            Track
          </h2>
          <div
            role="radiogroup"
            aria-labelledby="apex-drive-track-label"
            className="grid gap-2"
          >
            {tracks.map((track) => {
              const board = boards[track.id];
              const selected = track.id === resolvedTrackId;
              return (
                <button
                  key={track.id}
                  type="button"
                  role="radio"
                  data-apex-drive-track={track.id}
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    selectOnActivate(event, () => {
                      setTrackId(track.id);
                      saveSelectedTrackId(track.id);
                    });
                  }}
                  style={{ touchAction: "manipulation" }}
                  className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                    selected
                      ? "border-orange-500/50 bg-orange-500/10"
                      : "border-zinc-800/80 bg-zinc-950/50 hover:border-zinc-700"
                  }`}
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
                  {selected ? (
                    <span className="shrink-0 text-xs font-medium text-orange-400">
                      Selected
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        {selectedTrack ? (
          <Link
            href={`/drive/${selectedTrack.id}?car=${carId}`}
            data-apex-drive-go
            className="apex-btn apex-btn--cta inline-flex min-h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold"
          >
            Drive {selectedTrack.name} →
          </Link>
        ) : null}

        <p className="text-[11px] text-zinc-600">
          Local game boards are stored in this browser only under{" "}
          <code className="text-zinc-500">apex.drive.*</code> and never feed
          real lap leaderboards.
        </p>
      </main>
    </>
  );
}
