"use client";

import { ExcludeFromBestControl } from "@/components/ExcludeFromBestControl";
import { UnsplitLapsBanner } from "@/components/ReparseLapsCallout";
import { SectionSaveHint } from "@/components/SectionSaveHint";
import { formatLapTime } from "@/lib/format";
import {
  bestLapTimeMs,
  isLapExcluded,
  suspicionByLapId,
  type LapSuspicion,
} from "@/lib/lap-quality";
import { looksLikeUnsplitLaps } from "@/lib/session-reparse";
import type { LapRow } from "@/lib/types";
import type { ReactNode } from "react";

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
  syncedLapIds?: Set<string>,
): { text: string; className: string; title: string } | null {
  if (dedicated.has(lapId)) {
    const synced = syncedLapIds?.has(lapId) ?? false;
    return {
      text: synced ? "Synced" : "Not synced",
      className: synced ? "text-emerald-300" : "text-orange-300",
      title: synced
        ? "YouTube attached and point-matched"
        : "YouTube attached — pin chart + Sync here",
    };
  }
  if (sessionVideo) {
    const synced = syncedLapIds?.has("__session__") ?? false;
    return {
      text: synced ? "Synced" : "sess",
      className: synced ? "text-emerald-300" : "text-zinc-500",
      title: synced
        ? "Session-level YouTube is synced"
        : "Session-level YouTube — open a lap to sync",
    };
  }
  return null;
}

export function LapList({
  laps,
  selectedId,
  onSelect,
  videoLapIds,
  syncedLapIds,
  sessionVideo = false,
  canEdit = false,
  onExcludeChange,
  excludeBusyId,
  onReparseLaps,
  reparsePanel,
  headerActions,
  excludeDirty = false,
  onSaveExclude,
  onDiscardExclude,
  saving = false,
}: {
  laps: LapRow[];
  /** When set with onSelect, rows select in place instead of navigating. */
  selectedId?: string | null;
  onSelect?: (lap: LapRow) => void;
  /** Lap ids with a dedicated YouTube clip. */
  videoLapIds?: Set<string> | string[];
  /** Lap ids whose video syncSource is intentional (manual/auto/time_of_day). */
  syncedLapIds?: Set<string> | string[];
  /** Session-level video covers all laps. */
  sessionVideo?: boolean;
  /** Session owner — show exclude/include per row. */
  canEdit?: boolean;
  onExcludeChange?: (change: LapExcludeChange) => void;
  excludeBusyId?: string | null;
  /**
   * Owner unsplit callout — Re-parse lives in the laps header (no duplicate).
   */
  onReparseLaps?: () => void;
  /** Inline re-parse panel rendered under the laps header. */
  reparsePanel?: ReactNode;
  /** Extra controls next to the laps header (e.g. Re-parse laps). */
  headerActions?: ReactNode;
  /** Show Save near the table when exclude drafts are pending. */
  excludeDirty?: boolean;
  onSaveExclude?: () => void;
  onDiscardExclude?: () => void;
  saving?: boolean;
}) {
  const fastest = bestLapTimeMs(laps);
  const flags = suspicionByLapId(laps);
  const dedicated = toDedicatedSet(videoLapIds);
  const synced = toDedicatedSet(syncedLapIds);
  const unsplit = Boolean(onReparseLaps && looksLikeUnsplitLaps(laps));
  const gridCols = canEdit
    ? "grid-cols-[3rem_1fr_auto_auto_auto] sm:grid-cols-[3.5rem_1fr_auto_auto_auto]"
    : "grid-cols-[3.5rem_1fr_auto_auto] sm:grid-cols-[4rem_1fr_auto_auto]";

  return (
    <div className="overflow-hidden rounded-xl border-0 bg-transparent">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2 sm:px-3">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Lap times
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {headerActions}
          {canEdit && onReparseLaps ? (
            <button
              type="button"
              data-testid="toolbar-reparse"
              onClick={onReparseLaps}
              className="apex-btn apex-btn--accent"
            >
              <span aria-hidden>↻</span> Re-parse laps
            </button>
          ) : null}
        </div>
      </div>
      {excludeDirty ? (
        <div className="border-b border-zinc-800/80 px-2.5 py-1.5 sm:px-3">
          <SectionSaveHint
            dirty
            saving={saving}
            label="Unsaved exclude"
            onSave={onSaveExclude}
            onDiscard={onDiscardExclude}
          />
        </div>
      ) : null}
      {reparsePanel ? (
        <div className="border-b border-zinc-800/80 bg-zinc-950/80 p-3">
          {reparsePanel}
        </div>
      ) : null}
      {unsplit && onReparseLaps && !reparsePanel ? (
        <div className="border-b border-zinc-800/80 bg-zinc-950/60 px-2.5 py-2 sm:px-3">
          <UnsplitLapsBanner onClick={onReparseLaps} />
        </div>
      ) : null}
      <div
        className={`grid gap-x-2 border-b border-zinc-800/80 bg-zinc-950/60 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500 sm:px-3 ${gridCols}`}
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
          const vid = videoMark(lap.id, dedicated, sessionVideo, synced);
          const rowClass = `grid min-h-9 w-full items-center gap-x-2 px-2.5 py-1.5 text-left text-sm transition sm:px-3 ${gridCols} ${
            excluded ? "opacity-45" : ""
          } ${
            selected
              ? "bg-orange-500/15 ring-1 ring-inset ring-orange-500/40"
              : "hover:bg-zinc-900/80"
          }`;

          const excludeControl =
            canEdit && onExcludeChange ? (
              <div
                className="flex justify-end"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <ExcludeFromBestControl
                  size="row"
                  excluded={excluded}
                  busy={busy}
                  reason={lap.exclude_reason}
                  title={
                    suspicion
                      ? suspicion.labels.join("; ")
                      : "Exclude from best"
                  }
                  onChange={(next) => {
                    onExcludeChange({
                      lapId: lap.id,
                      excluded: next.excluded,
                      exclude_reason: next.excluded
                        ? suspicion
                          ? suspicion.labels.join("; ")
                          : next.exclude_reason
                        : null,
                    });
                  }}
                />
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
              {excludeControl}
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
  syncedLapIds,
  sessionVideo = false,
}: {
  laps: LapRow[];
  selectedId?: string | null;
  onSelect: (lap: LapRow) => void;
  videoLapIds?: Set<string> | string[];
  syncedLapIds?: Set<string> | string[];
  sessionVideo?: boolean;
}) {
  const fastest = bestLapTimeMs(laps);
  const dedicated = toDedicatedSet(videoLapIds);
  const synced = toDedicatedSet(syncedLapIds);

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
        const vid = videoMark(lap.id, dedicated, sessionVideo, synced);
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
