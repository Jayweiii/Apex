"use client";

import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "@/lib/playback";
import { formatClock } from "@/lib/format";

/**
 * Shared play/pause · speed · scrub bar for session + compare playback.
 * Clock is owned by the parent (`progress` / `onProgress` / `playing`).
 */
export function PlaybackControls({
  progress,
  onProgress,
  playing,
  onTogglePlay,
  speed,
  onSpeed,
  durationMs,
  disabled = false,
  label = "Playback",
  hint = "Space play/pause · ← → scrub · 1–4 speed",
}: {
  progress: number;
  onProgress: (next: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: PlaybackSpeed;
  onSpeed: (next: PlaybackSpeed) => void;
  durationMs: number;
  disabled?: boolean;
  label?: string;
  hint?: string;
}) {
  const durationSec = Math.max(0, durationMs / 1000);
  const atSec = progress * durationSec;

  return (
    <div
      className="w-full space-y-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4"
      role="group"
      aria-label={label}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {label}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onTogglePlay}
            className="min-h-10 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Playback speed"
          >
            {PLAYBACK_SPEEDS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                onClick={() => onSpeed(value)}
                aria-pressed={speed === value}
                className={`min-h-9 rounded-md px-2 font-mono text-xs transition ${
                  speed === value
                    ? "bg-zinc-100 text-zinc-950"
                    : "border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                } disabled:opacity-40`}
              >
                {value === 1 ? "1x" : `${value}x`}
              </button>
            ))}
          </div>
          <span className="font-mono text-sm text-zinc-300">
            {formatClock(atSec)}
            <span className="text-zinc-600">
              {" "}
              / {formatClock(durationSec)}
            </span>
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="sr-only">Scrub</span>
        <input
          type="range"
          min={0}
          max={1000}
          disabled={disabled}
          value={Math.round(progress * 1000)}
          onChange={(event) => {
            onProgress(Number(event.target.value) / 1000);
          }}
          className="w-full accent-orange-500 disabled:opacity-40"
        />
      </label>
    </div>
  );
}
