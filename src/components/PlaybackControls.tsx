"use client";

import {
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "@/lib/playback";
import { formatClock } from "@/lib/format";
import { SegmentedControl } from "@/components/SegmentedControl";
import {
  useLiveProgress,
  type ProgressSubscribe,
} from "@/components/useLiveProgress";

/**
 * Shared play/pause · speed · scrub bar for session + compare playback.
 * Clock is owned by the parent (`progress` / `onProgress` / `playing`).
 * Primary Play stays ≥44pt and sticky-capable for mobile (see docs/UI_RULES.md).
 */
export function PlaybackControls({
  progress: progressProp,
  progressSubscribe,
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
  /**
   * Clock subscription. When given, the bar tracks playback itself so the
   * parent need not re-render every frame (see usePlaybackClock).
   */
  progressSubscribe?: ProgressSubscribe;
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
  const progress = useLiveProgress(progressProp, playing, progressSubscribe);
  const durationSec = Math.max(0, durationMs / 1000);
  const atSec = progress * durationSec;

  const speedOptions = PLAYBACK_SPEEDS.map((value) => ({
    value: String(value),
    label: value === 1 ? "1x" : `${value}x`,
  }));

  return (
    <div
      className={`w-full border border-zinc-800/80 bg-zinc-950/90 ${
        compact
          ? "space-y-1.5 rounded-xl px-2.5 py-2 backdrop-blur"
          : "space-y-2 rounded-2xl p-3 sm:p-4"
      } ${sticky ? "sticky bottom-0 z-10 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]" : ""}`}
      role="group"
      aria-label={label}
      data-apex-playback-controls="1"
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
            className="apex-btn apex-btn--primary apex-btn--cta inline-flex box-border flex-none justify-center overflow-hidden"
            aria-label={playing ? "Pause" : "Play"}
            data-apex-play-toggle
            style={{
              width: 96,
              minWidth: 96,
              maxWidth: 96,
              minHeight: "var(--apex-tap-min)",
              flex: "0 0 96px",
            }}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <SegmentedControl
            value={String(speed)}
            options={speedOptions}
            onChange={(next) => onSpeed(Number(next) as PlaybackSpeed)}
            ariaLabel="Playback speed"
            compact
            disabled={disabled}
          />
          <span
            className={`font-mono text-zinc-300 ${
              compact ? "text-xs" : "text-sm"
            }`}
            data-apex-playback-clock
            data-apex-playback-at={atSec.toFixed(1)}
            data-apex-playback-total={durationSec.toFixed(1)}
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
