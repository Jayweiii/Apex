"use client";

import { AppHeader } from "@/components/AppHeader";
import { fetchSharedTracks } from "@/lib/cloud-tracks";
import { builtinCenterline } from "@/lib/centerlines";
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
  resolveBuiltinAlias,
  setSharedTracksCache,
  type Track,
} from "@/lib/tracks";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";

const SUGGESTED = [
  "thunderhill-west",
  "thunderhill-east",
  "custom-thunderhill-west",
  "custom-thunderhill-east",
];

const TRACK_KEY = "apex.drive.selectedTrack";
const DEFAULT_CAR: DriveCarId = "miata";
const DEFAULT_TRACK = "thunderhill-west";

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

function isDriveableTrack(track: Track): boolean {
  return Boolean(
    builtinCenterline(track.id) ||
      builtinCenterline(resolveBuiltinAlias(track.id)),
  );
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

/**
 * Radiogroup keyboard: arrows move focus + selection; Space/Enter select.
 * Do not call preventDefault on pointer/touch — React roots are passive and
 * that logs "Unable to preventDefault inside passive event listener".
 */
function onRadioKeyDown(
  event: KeyboardEvent<HTMLElement>,
  ids: string[],
  selectedId: string,
  selectId: (id: string) => void,
) {
  const key = event.key;
  if (key !== "ArrowDown" && key !== "ArrowRight" && key !== "ArrowUp" && key !== "ArrowLeft" && key !== " " && key !== "Enter") {
    return;
  }
  event.preventDefault();
  if (key === " " || key === "Enter") {
    selectId(selectedId);
    return;
  }
  const idx = Math.max(0, ids.indexOf(selectedId));
  const delta = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
  const next = ids[(idx + delta + ids.length) % ids.length]!;
  selectId(next);
  // Focus moves with selection (roving tabindex).
  queueMicrotask(() => {
    const el = event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelector<HTMLElement>(`[role="radio"][data-apex-drive-car="${next}"], [role="radio"][data-apex-drive-track="${next}"]`);
    el?.focus();
  });
}

export function DriveHub() {
  const [extra, setExtra] = useState<Track[]>([]);
  // SSR-stable defaults — never read localStorage in useState (React #418).
  const [carId, setCarId] = useState<DriveCarId>(DEFAULT_CAR);
  const [trackId, setTrackId] = useState<string>(DEFAULT_TRACK);
  const [prefsReady, setPrefsReady] = useState(false);
  const [boardTick, setBoardTick] = useState(0);

  useEffect(() => {
    setCarId(loadSelectedCarId());
    setTrackId(loadSelectedTrackId(DEFAULT_TRACK));
    setPrefsReady(true);
  }, []);

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
    const all = popularTracks("", extra).filter(isDriveableTrack);
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

  function selectCar(id: DriveCarId) {
    setCarId(id);
    saveSelectedCarId(id);
  }

  function selectTrack(id: string) {
    setTrackId(id);
    saveSelectedTrackId(id);
  }

  const carIds = DRIVE_CARS.map((c) => c.id);
  const trackIds = tracks.map((t) => t.id);

  return (
    <>
      <AppHeader />
      <main
        data-apex-drive-car-track-select="1"
        data-apex-drive-prefs-ready={prefsReady ? "1" : "0"}
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
            onKeyDown={(event) =>
              onRadioKeyDown(event, carIds, carId, (id) =>
                selectCar(id as DriveCarId),
              )
            }
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
                  onClick={() => selectCar(car.id)}
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
            onKeyDown={(event) =>
              onRadioKeyDown(event, trackIds, resolvedTrackId, selectTrack)
            }
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
                  onClick={() => selectTrack(track.id)}
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

        <Link
          href="/kart2"
          data-apex-kart2-entry="1"
          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm"
        >
          <span>
            <span className="font-semibold text-orange-200">Apex Kart</span>
            <span className="block text-xs text-zinc-400">
              Pixel 3D karts on real circuits — stick to steer, drift for boost, race your telemetry
            </span>
          </span>
          <span aria-hidden className="text-orange-300">→</span>
        </Link>

        <Link
          href="/kart"
          data-apex-kart-entry="1"
          className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 text-sm"
        >
          <span>
            <span className="font-semibold text-zinc-200">Classic Apex Kart</span>
            <span className="block text-xs text-zinc-500">
              The original top-down beta
            </span>
          </span>
          <span aria-hidden className="text-zinc-500">→</span>
        </Link>

        <p className="text-[11px] text-zinc-600">
          Local game boards are stored in this browser only under{" "}
          <code className="text-zinc-500">apex.drive.*</code> and never feed
          real lap leaderboards.
        </p>
      </main>
    </>
  );
}
