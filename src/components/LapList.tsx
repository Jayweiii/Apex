"use client";

import { formatLapTime } from "@/lib/format";
import type { LapRow } from "@/lib/types";

export function LapList({
  laps,
  selectedId,
  onSelect,
}: {
  laps: LapRow[];
  /** When set with onSelect, rows select in place instead of navigating. */
  selectedId?: string | null;
  onSelect?: (lap: LapRow) => void;
}) {
  const fastest = Math.min(...laps.map((lap) => lap.lap_time_ms));

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
      <div className="grid grid-cols-[3.5rem_1fr_auto] border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500 sm:grid-cols-[4rem_1fr_auto] sm:px-4">
        <span>Lap</span>
        <span>Time</span>
        <span className="text-right">Delta</span>
      </div>
      <ul role={onSelect ? "listbox" : undefined} aria-label="Laps">
        {laps.map((lap) => {
          const isFastest = lap.lap_time_ms === fastest;
          const delta = lap.lap_time_ms - fastest;
          const selected = selectedId === lap.id;
          const className = `grid min-h-12 w-full grid-cols-[3.5rem_1fr_auto] items-center px-3 py-2.5 text-left transition sm:grid-cols-[4rem_1fr_auto] sm:px-4 ${
            selected
              ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/40"
              : "hover:bg-zinc-900/80"
          }`;

          const body = (
            <>
              <span className="font-mono text-sm text-zinc-400">
                {String(lap.lap_number).padStart(2, "0")}
              </span>
              <span
                className={`font-mono text-lg tracking-tight ${
                  isFastest ? "text-orange-400" : "text-zinc-100"
                }`}
              >
                {formatLapTime(lap.lap_time_ms)}
                {isFastest ? (
                  <span className="ml-2 text-[10px] font-sans uppercase tracking-[0.2em] text-orange-500">
                    Best
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-sm text-zinc-500">
                {delta === 0 ? "—" : `+${(delta / 1000).toFixed(3)}`}
              </span>
            </>
          );

          return (
            <li key={lap.id} role={onSelect ? "option" : undefined}>
              {onSelect ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => onSelect(lap)}
                  className={className}
                >
                  {body}
                </button>
              ) : (
                <div className={className}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Compact chip row for selecting a lap without leaving the session page. */
export function LapChips({
  laps,
  selectedId,
  onSelect,
}: {
  laps: LapRow[];
  selectedId?: string | null;
  onSelect: (lap: LapRow) => void;
}) {
  const fastest = Math.min(...laps.map((lap) => lap.lap_time_ms));

  return (
    <div
      className="flex flex-wrap gap-2"
      role="listbox"
      aria-label="Select lap"
    >
      {laps.map((lap) => {
        const selected = selectedId === lap.id;
        const isFastest = lap.lap_time_ms === fastest;
        return (
          <button
            key={lap.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(lap)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 font-mono text-sm transition ${
              selected
                ? "border-orange-500/60 bg-orange-500/15 text-orange-200"
                : "border-zinc-800 bg-zinc-950/60 text-zinc-300 hover:border-zinc-600"
            }`}
          >
            <span className="text-zinc-500">
              {String(lap.lap_number).padStart(2, "0")}
            </span>
            <span className={isFastest ? "text-orange-400" : undefined}>
              {formatLapTime(lap.lap_time_ms)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
