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
  compact = false,
  sticky = false,
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
  /** Dense bar for one-screen session/compare dashboards. */
  compact?: boolean;
  /** Stick under the video while telemetry scrolls. */
  sticky?: boolean;
}) {
  const durationSec = Math.max(0, durationMs / 1000);
  const atSec = progress * durationSec;

  return (
    <div
      className={`w-full border border-zinc-800/80 bg-zinc-950/90 ${
        compact
          ? "space-y-1.5 rounded-xl px-2.5 py-2 backdrop-blur"
          : "space-y-2 rounded-2xl p-3 sm:p-4"
      } ${sticky ? "sticky bottom-0 z-10 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]" : ""}`}
      role="group"
      aria-label={label}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={compact ? "min-w-0" : undefined}>
          <p
            className={`uppercase tracking-[0.18em] text-zinc-500 ${
              compact ? "text-[10px]" : "text-[11px]"
            }`}
          >
            {label}
          </p>
          {!compact ? (
            <p className="mt-1 text-xs text-zinc-500">{hint}</p>
          ) : (
            <p className="sr-only">{hint}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onTogglePlay}
            className={`apex-btn apex-btn--primary inline-flex justify-center ${
              compact ? "min-h-8 px-0 py-1 text-xs" : "apex-btn--cta px-0"
            }`}
            aria-label={playing ? "Pause" : "Play"}
          >
            {/* Fixed slot so Play→Pause never shifts speed buttons. */}
            <span
              className="inline-grid place-items-center font-semibold"
              style={{ width: compact ? "4.5rem" : "5rem" }}
              aria-hidden={false}
            >
              <span className="col-start-1 row-start-1">{playing ? "Pause" : "Play"}</span>
            </span>
          </button>
          <div
            className="flex items-center gap-0.5"
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
                className={`apex-btn font-mono normal-case tracking-normal ${
                  compact ? "min-h-7 px-1.5 text-[11px]" : "min-h-9 px-2 text-xs"
                } ${speed === value ? "apex-btn--pressed" : ""}`}
              >
                {value === 1 ? "1x" : `${value}x`}
              </button>
            ))}
          </div>
          <span
            className={`font-mono text-zinc-300 ${
              compact ? "text-xs" : "text-sm"
            }`}
          >
            {formatClock(atSec)}
            <span className="text-zinc-600">
              {" "}
              / {formatClock(durationSec)}
            </span>
          </span>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
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
