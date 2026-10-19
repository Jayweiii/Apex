"use client";

import { formatLapTime } from "@/lib/format";
import {
  bestLapTimeMs,
  isLapExcluded,
  suspicionByLapId,
  type LapSuspicion,
} from "@/lib/lap-quality";
import type { LapRow } from "@/lib/types";

export type LapExcludeChange = {
  lapId: string;
  excluded: boolean;
  exclude_reason?: string | null;
};

function toDedicatedSet(
  videoLapIds?: Set<string> | string[],
): Set<string> {
  if (!videoLapIds) return new Set();
  return videoLapIds instanceof Set ? videoLapIds : new Set(videoLapIds);
}

function videoMark(
  lapId: string,
  dedicated: Set<string>,
  sessionVideo: boolean,
): { text: string; className: string; title: string } | null {
  if (dedicated.has(lapId)) {
    return {
      text: "YT",
      className: "text-orange-400",
      title: "Dedicated YouTube for this lap",
    };
  }
  if (sessionVideo) {
    return {
      text: "sess",
      className: "text-zinc-500",
      title: "Session-level YouTube",
    };
  }
  return null;
}

export function LapList({
  laps,
  selectedId,
  onSelect,
  videoLapIds,
  sessionVideo = false,
  canEdit = false,
  onExcludeChange,
  excludeBusyId,
}: {
  laps: LapRow[];
  /** When set with onSelect, rows select in place instead of navigating. */
  selectedId?: string | null;
  onSelect?: (lap: LapRow) => void;
  /** Lap ids with a dedicated YouTube clip. */
  videoLapIds?: Set<string> | string[];
  /** Session-level video covers all laps. */
  sessionVideo?: boolean;
  /** Session owner — show exclude toggle / one-click flag actions. */
  canEdit?: boolean;
  onExcludeChange?: (change: LapExcludeChange) => void;
  excludeBusyId?: string | null;
}) {
  const fastest = bestLapTimeMs(laps);
  const flags = suspicionByLapId(laps);
  const dedicated = toDedicatedSet(videoLapIds);
  const gridCols = canEdit
    ? "grid-cols-[3rem_1fr_auto_auto_auto] sm:grid-cols-[3.5rem_1fr_auto_auto_auto]"
    : "grid-cols-[3.5rem_1fr_auto_auto] sm:grid-cols-[4rem_1fr_auto_auto]";

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
      <div
        className={`grid gap-x-2 border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500 sm:px-4 ${gridCols}`}
      >
        <span>Lap</span>
        <span>Time</span>
        <span className="text-right">Video</span>
        <span className="text-right">Delta</span>
        {canEdit ? <span className="text-right">Best</span> : null}
      </div>
      <ul role={onSelect ? "listbox" : undefined} aria-label="Laps">
        {laps.map((lap) => {
          const excluded = isLapExcluded(lap);
          const suspicion = flags.get(lap.id);
          const isFastest =
            !excluded && fastest != null && lap.lap_time_ms === fastest;
          const delta =
            !excluded && fastest != null ? lap.lap_time_ms - fastest : null;
          const selected = selectedId === lap.id;
          const busy = excludeBusyId === lap.id;
          const vid = videoMark(lap.id, dedicated, sessionVideo);
          const rowClass = `grid min-h-12 w-full items-center gap-x-2 px-3 py-2.5 text-left transition sm:px-4 ${gridCols} ${
            excluded ? "opacity-45" : ""
          } ${
            selected
              ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/40"
              : "hover:bg-zinc-900/80"
          }`;

          const excludeControls =
            canEdit && onExcludeChange ? (
              <div
                className="flex flex-col items-end gap-1"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500"
                  title="Exclude from session best and leaderboards"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 accent-orange-500"
                    checked={excluded}
                    disabled={busy}
                    onChange={(event) => {
                      onExcludeChange({
                        lapId: lap.id,
                        excluded: event.target.checked,
                        exclude_reason: event.target.checked ? "manual" : null,
                      });
                    }}
                    aria-label={`Exclude lap ${lap.lap_number} from best`}
                  />
                  <span className="hidden sm:inline">Exclude</span>
                </label>
                {!excluded && suspicion ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onExcludeChange({
                        lapId: lap.id,
                        excluded: true,
                        exclude_reason: suspicion.labels.join("; "),
                      });
                    }}
                    className="text-[10px] uppercase tracking-[0.14em] text-amber-400/90 hover:text-amber-300 disabled:opacity-50"
                  >
                    Exclude
                  </button>
                ) : null}
              </div>
            ) : null;

          const cells = (
            <>
              <span className="font-mono text-sm text-zinc-400">
                {String(lap.lap_number).padStart(2, "0")}
              </span>
              <span
                className={`min-w-0 font-mono text-lg tracking-tight ${
                  isFastest ? "text-orange-400" : "text-zinc-100"
                }`}
              >
                <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                  {formatLapTime(lap.lap_time_ms)}
                  {isFastest ? (
                    <span className="text-[10px] font-sans uppercase tracking-[0.2em] text-orange-500">
                      Best
                    </span>
                  ) : null}
                  {excluded ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-sans uppercase tracking-[0.16em] text-zinc-500"
                      title={lap.exclude_reason ?? "Excluded from best"}
                    >
                      <ExcludedIcon />
                      Excluded
                    </span>
                  ) : null}
                  {!excluded && suspicion ? (
                    <SuspicionBadge suspicion={suspicion} />
                  ) : null}
                </span>
              </span>
              <span
                className={`px-2 text-right text-[10px] uppercase tracking-[0.14em] ${
                  vid?.className ?? "text-zinc-700"
                }`}
                title={vid?.title ?? "No video"}
              >
                {vid?.text ?? "—"}
              </span>
              <span className="font-mono text-sm text-zinc-500">
                {delta == null
                  ? "—"
                  : delta === 0
                    ? "—"
                    : `+${(delta / 1000).toFixed(3)}`}
              </span>
              {excludeControls}
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
                  className={rowClass}
                >
                  {cells}
                </button>
              ) : (
                <div className={rowClass}>{cells}</div>
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
  videoLapIds,
  sessionVideo = false,
}: {
  laps: LapRow[];
  selectedId?: string | null;
  onSelect: (lap: LapRow) => void;
  videoLapIds?: Set<string> | string[];
  sessionVideo?: boolean;
}) {
  const fastest = bestLapTimeMs(laps);
  const dedicated = toDedicatedSet(videoLapIds);

  return (
    <div
      className="flex flex-wrap gap-2"
      role="listbox"
      aria-label="Select lap"
    >
      {laps.map((lap) => {
        const selected = selectedId === lap.id;
        const excluded = isLapExcluded(lap);
        const isFastest =
          !excluded && fastest != null && lap.lap_time_ms === fastest;
        const vid = videoMark(lap.id, dedicated, sessionVideo);
        return (
          <button
            key={lap.id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => onSelect(lap)}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 font-mono text-sm transition ${
              excluded ? "opacity-45" : ""
            } ${
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
            {excluded ? (
              <span className="text-[10px] font-sans uppercase tracking-[0.12em] text-zinc-500">
                Excl
              </span>
            ) : null}
            {vid ? (
              <span
                className={`text-[10px] uppercase tracking-[0.12em] ${vid.className}`}
                title={vid.title}
              >
                {vid.text}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function SuspicionBadge({ suspicion }: { suspicion: LapSuspicion }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-sans uppercase tracking-[0.14em] text-amber-200/90"
      title={suspicion.labels.join(" · ")}
    >
      <WarningIcon />
      {suspicion.labels[0]}
      {suspicion.labels.length > 1 ? ` +${suspicion.labels.length - 1}` : ""}
    </span>
  );
}

function ExcludedIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.5 4.5l7 7" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="size-3 shrink-0"
      fill="currentColor"
    >
      <path d="M8 1.5 14.5 13H1.5L8 1.5Zm0 3.2-.9 5h1.8l-.9-5ZM8 11a.9.9 0 1 0 0 1.8A.9.9 0 0 0 8 11Z" />
    </svg>
  );
}
