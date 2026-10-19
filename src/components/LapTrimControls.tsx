"use client";

import {
  nudgeTrimBound,
  resolveLapTrimBounds,
  type TrimableLap,
} from "@/lib/lap-trim";
import { formatLapTime } from "@/lib/format";

/**
 * Owner controls to nudge / type lap start & end (session-time seconds),
 * reset to auto, and optional merge/split with adjacent laps.
 */
export function LapTrimControls({
  lap,
  canMergeNext,
  canSplit,
  previewLapTimeMs,
  onChange,
  onReset,
  onMergeNext,
  onSplit,
  busy = false,
}: {
  lap: TrimableLap;
  canMergeNext?: boolean;
  canSplit?: boolean;
  previewLapTimeMs: number;
  onChange: (next: {
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) => void;
  onReset: () => void;
  onMergeNext?: () => void;
  onSplit?: () => void;
  busy?: boolean;
}) {
  const bounds = resolveLapTrimBounds(lap);
  const minGap = 1; // seconds

  function setStart(next: number) {
    const clamped = nudgeTrimBound(
      next,
      0,
      bounds.autoStart,
      bounds.effectiveEnd - minGap,
    );
    onChange({
      start_offset_override:
        Math.abs(clamped - bounds.autoStart) < 0.0005 ? null : clamped,
      end_offset_override:
        lap.end_offset_override != null
          ? lap.end_offset_override
          : Math.abs(bounds.effectiveEnd - bounds.autoEnd) < 0.0005
            ? null
            : bounds.effectiveEnd,
    });
  }

  function setEnd(next: number) {
    const clamped = nudgeTrimBound(
      next,
      0,
      bounds.effectiveStart + minGap,
      bounds.autoEnd,
    );
    onChange({
      start_offset_override:
        lap.start_offset_override != null
          ? lap.start_offset_override
          : Math.abs(bounds.effectiveStart - bounds.autoStart) < 0.0005
            ? null
            : bounds.effectiveStart,
      end_offset_override:
        Math.abs(clamped - bounds.autoEnd) < 0.0005 ? null : clamped,
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Lap trim
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Adjust splitter start/end · live time{" "}
            <span className="font-mono text-zinc-200">
              {formatLapTime(previewLapTimeMs)}
            </span>
            {bounds.hasOverride ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-sky-400">
                Override
              </span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !bounds.hasOverride}
          onClick={onReset}
          className="min-h-9 rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.14em] text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
        >
          Reset to auto
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <BoundEditor
          label="Start"
          value={bounds.effectiveStart}
          autoValue={bounds.autoStart}
          disabled={busy}
          onNudge={(delta) => setStart(bounds.effectiveStart + delta)}
          onCommit={setStart}
        />
        <BoundEditor
          label="End"
          value={bounds.effectiveEnd}
          autoValue={bounds.autoEnd}
          disabled={busy}
          onNudge={(delta) => setEnd(bounds.effectiveEnd + delta)}
          onCommit={setEnd}
        />
      </div>

      {(onMergeNext || onSplit) && (
        <div className="flex flex-wrap gap-2">
          {onMergeNext ? (
            <button
              type="button"
              disabled={busy || !canMergeNext}
              onClick={onMergeNext}
              className="min-h-9 rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.14em] text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
            >
              Merge with next
            </button>
          ) : null}
          {onSplit ? (
            <button
              type="button"
              disabled={busy || !canSplit}
              onClick={onSplit}
              className="min-h-9 rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.14em] text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
            >
              Split at cursor
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function BoundEditor({
  label,
  value,
  autoValue,
  disabled,
  onNudge,
  onCommit,
}: {
  label: string;
  value: number;
  autoValue: number;
  disabled?: boolean;
  onNudge: (delta: number) => void;
  onCommit: (next: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-zinc-500">
        <span>{label}</span>
        <span className="font-mono normal-case tracking-normal text-zinc-600">
          auto {autoValue.toFixed(1)}s
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onNudge(-0.1)}
          className="min-h-10 min-w-10 rounded-lg border border-zinc-800 text-sm text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
          aria-label={`Nudge ${label} −0.1s`}
        >
          −0.1
        </button>
        <input
          type="number"
          step={0.1}
          disabled={disabled}
          value={Number(value.toFixed(3))}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onCommit(next);
          }}
          className="min-h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 font-mono text-sm text-zinc-100"
          aria-label={`${label} session time seconds`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => onNudge(0.1)}
          className="min-h-10 min-w-10 rounded-lg border border-zinc-800 text-sm text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
          aria-label={`Nudge ${label} +0.1s`}
        >
          +0.1
        </button>
      </div>
    </div>
  );
}
