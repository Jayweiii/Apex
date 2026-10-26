"use client";

import {
  clampTrimDrag,
  resolveLapTrimBounds,
  type TrimableLap,
} from "@/lib/lap-trim";
import { formatLapTime } from "@/lib/format";

/**
 * Owner controls to nudge / type lap start & end (session-time seconds),
 * reset to auto, and optional merge/split with adjacent laps.
 * Handles clamp to session data range only (start < end) — not auto bounds.
 */
export function LapTrimControls({
  lap,
  sessionMin,
  sessionMax,
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
  /** Full session telemetry min (session seconds). */
  sessionMin: number;
  /** Full session telemetry max (session seconds). */
  sessionMax: number;
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
  const session = { min: sessionMin, max: sessionMax };

  function publish(start: number, end: number) {
    onChange({
      start_offset_override:
        Math.abs(start - bounds.autoStart) < 0.0005 ? null : start,
      end_offset_override:
        Math.abs(end - bounds.autoEnd) < 0.0005 ? null : end,
    });
  }

  function setStart(next: number) {
    const clamped = clampTrimDrag(
      "start",
      next,
      { start: bounds.effectiveStart, end: bounds.effectiveEnd },
      session,
      minGap,
    );
    publish(clamped.start, clamped.end);
  }

  function setEnd(next: number) {
    const clamped = clampTrimDrag(
      "end",
      next,
      { start: bounds.effectiveStart, end: bounds.effectiveEnd },
      session,
      minGap,
    );
    publish(clamped.start, clamped.end);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Lap trim
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Drag either handle both ways · live time{" "}
            <span className="font-mono text-zinc-200">
              {formatLapTime(previewLapTimeMs)}
            </span>
            {bounds.hasOverride ? (
              <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-sky-400">
                Override
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Session {sessionMin.toFixed(1)}s – {sessionMax.toFixed(1)}s · grey
            pads are neighbor data
          </p>
        </div>
        <button
          type="button"
          disabled={busy || !bounds.hasOverride}
          onClick={onReset}
          className="apex-btn"
        >
          Reset to auto
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <BoundEditor
          key={`start-${lap.id}-${bounds.autoStart}-${bounds.autoEnd}`}
          label="Start"
          value={bounds.effectiveStart}
          autoValue={bounds.autoStart}
          disabled={busy}
          onNudge={(delta) => setStart(bounds.effectiveStart + delta)}
          onCommit={setStart}
        />
        <BoundEditor
          key={`end-${lap.id}-${bounds.autoStart}-${bounds.autoEnd}`}
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
              className="apex-btn"
            >
              Merge with next
            </button>
          ) : null}
          {onSplit ? (
            <button
              type="button"
              disabled={busy || !canSplit}
              onClick={onSplit}
              className="apex-btn"
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
          className="apex-btn apex-btn--icon"
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
          className="apex-btn apex-btn--icon"
          aria-label={`Nudge ${label} +0.1s`}
        >
          +0.1
        </button>
      </div>
    </div>
  );
}
