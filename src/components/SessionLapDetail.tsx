"use client";

import type { LapExcludeChange } from "@/components/LapList";
import { LapTrimControls } from "@/components/LapTrimControls";
import { SectionSaveHint } from "@/components/SectionSaveHint";
import type { SessionToolTab } from "@/components/SessionToolsPanel";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import { SyncedLapView } from "@/components/video/SyncedLapView";
import { formatGap, formatLapTime, formatSpeed } from "@/lib/format";
import {
  applyLapTrimWithSession,
  buildTrimChartContext,
  clampTrimDrag,
  resolveLapTrimBounds,
  type TrimableLap,
} from "@/lib/lap-trim";
import { bestLapTimeMs, isLapExcluded } from "@/lib/lap-quality";
import { pickSessionVideoForLap } from "@/lib/pick-session-video";
import type { StartFinishLine } from "@/lib/start-finish-line";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { useMemo, useState, type ReactNode } from "react";

export type SessionLapDetailLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  start_offset_sec?: number | null;
  telemetry: TelemetryPoint[];
  excluded?: boolean | null;
  exclude_reason?: string | null;
  start_offset_override?: number | null;
  end_offset_override?: number | null;
};

/**
 * In-place lap panel on the session page: map (selected lap only),
 * speed/G charts, delta vs best, synced YouTube, playback clock, optional trim.
 * Tools sit next to the surfaces they affect (map / video / chart headers).
 */
export function SessionLapDetail({
  sessionId,
  lap,
  siblingLaps,
  videos,
  videoParam,
  trackId,
  sessionStartedAtMs,
  onVideoChange,
  canEdit = false,
  onExcludeChange: _onExcludeChange,
  excludeBusy: _excludeBusy = false,
  onTrimChange,
  onTrimReset,
  onMergeNext,
  onSplit,
  trimBusy = false,
  layout = "workspace",
  sidebar,
  extraToolTabs,
  toolsOpenRequest,
  toolsShowButtons = true,
  mapHeader = null,
  trimDirty = false,
  videoDirty = false,
  onSave,
  onDiscard,
  saving = false,
  sfLine = null,
  sfEditing = false,
  onSfEndpointMove,
}: {
  sessionId: string;
  lap: SessionLapDetailLap;
  siblingLaps: SessionLapDetailLap[];
  videos: SessionVideo[];
  videoParam?: string | null;
  trackId?: string | null;
  sessionStartedAtMs?: number;
  onVideoChange?: (next: SessionVideo) => void;
  canEdit?: boolean;
  onExcludeChange?: (change: LapExcludeChange) => void;
  excludeBusy?: boolean;
  onTrimChange?: (change: {
    lapId: string;
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) => void;
  onTrimReset?: (lapId: string) => void;
  onMergeNext?: (lapId: string) => void;
  onSplit?: (lapId: string, progress: number) => void;
  trimBusy?: boolean;
  layout?: "stack" | "workspace";
  sidebar?: ReactNode;
  extraToolTabs?: SessionToolTab[];
  /** Legacy open-request for LocalGarage / compare. */
  toolsOpenRequest?: { tab: string; nonce: number } | null;
  /** When false, contextual headers own tools (session page). */
  toolsShowButtons?: boolean;
  mapHeader?: ReactNode;
  trimDirty?: boolean;
  videoDirty?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
  saving?: boolean;
  sfLine?: StartFinishLine | null;
  sfEditing?: boolean;
  onSfEndpointMove?: (which: "a" | "b", lat: number, lon: number) => void;
}) {
  void _onExcludeChange;
  void _excludeBusy;

  const trimable: TrimableLap = useMemo(
    () => ({
      id: lap.id,
      lap_number: lap.lap_number,
      lap_time_ms: lap.lap_time_ms,
      start_offset_sec: lap.start_offset_sec,
      telemetry: lap.telemetry,
      start_offset_override: lap.start_offset_override ?? null,
      end_offset_override: lap.end_offset_override ?? null,
    }),
    [lap],
  );

  const [speedUnit] = useSpeedUnit();
  const [trimOpen, setTrimOpen] = useState(Boolean(trimDirty));

  const siblingTrimables = useMemo(
    () =>
      siblingLaps.map((item) => ({
        id: item.id,
        lap_number: item.lap_number,
        lap_time_ms: item.lap_time_ms,
        start_offset_sec: item.start_offset_sec,
        telemetry: item.telemetry,
        start_offset_override: item.start_offset_override,
        end_offset_override: item.end_offset_override,
      })),
    [siblingLaps],
  );

  const applied = useMemo(
    () => applyLapTrimWithSession(trimable, siblingTrimables),
    [trimable, siblingTrimables],
  );
  const bounds = applied.bounds;
  const points = applied.telemetry;
  const peak = points.reduce((max, point) => {
    if (!Number.isFinite(point.speed) || point.speed < 0 || point.speed > 400) {
      return max;
    }
    return Math.max(max, point.speed);
  }, 0);

  const trimChart = useMemo(() => {
    if (!(canEdit && onTrimChange)) return null;
    return buildTrimChartContext(trimable, siblingTrimables);
  }, [canEdit, onTrimChange, trimable, siblingTrimables]);

  const siblingForBest = useMemo(
    () =>
      siblingLaps.map((item) => {
        if (item.id !== lap.id) {
          const trimmed = applyLapTrimWithSession(
            {
              id: item.id,
              lap_number: item.lap_number,
              lap_time_ms: item.lap_time_ms,
              start_offset_sec: item.start_offset_sec,
              telemetry: item.telemetry,
              start_offset_override: item.start_offset_override,
              end_offset_override: item.end_offset_override,
            },
            siblingTrimables,
          );
          return {
            ...item,
            lap_time_ms: trimmed.lap_time_ms,
            excluded: item.excluded,
          };
        }
        return {
          ...item,
          lap_time_ms: applied.lap_time_ms,
          excluded: lap.excluded,
        };
      }),
    [siblingLaps, lap, applied.lap_time_ms, siblingTrimables],
  );

  const bestMs = bestLapTimeMs(siblingForBest);
  const deltaSec =
    bestMs != null ? (applied.lap_time_ms - bestMs) / 1000 : null;

  const activeVideo: SessionVideo | null = useMemo(
    () =>
      pickSessionVideoForLap(videos, lap.id, {
        videoId: videoParam,
        youtubeOnly: true,
      }),
    [videos, videoParam, lap.id],
  );

  function commitTrim(next: {
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) {
    onTrimChange?.({
      lapId: lap.id,
      ...next,
    });
    setTrimOpen(true);
  }

  if (!lap.telemetry.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
        No speed samples on this lap.
      </p>
    );
  }

  const orderedSiblings = [...siblingLaps].sort(
    (a, b) => a.lap_number - b.lap_number,
  );
  const idx = orderedSiblings.findIndex((item) => item.id === lap.id);
  const canMergeNext = idx >= 0 && idx < orderedSiblings.length - 1;
  const canSplit = points.length >= 4;

  const chartLap =
    canEdit && onTrimChange && trimChart
      ? {
          id: lap.id,
          lap_number: lap.lap_number,
          lap_time_ms: Math.round(
            (trimChart.points[trimChart.points.length - 1].t -
              trimChart.points[0].t) *
              1000,
          ),
          start_offset_sec: trimChart.chartOriginSessionT,
          telemetry: trimChart.points,
        }
      : {
          id: lap.id,
          lap_number: lap.lap_number,
          lap_time_ms: applied.lap_time_ms,
          start_offset_sec: applied.start_offset_sec,
          telemetry: points,
        };

  const displaySiblingLaps = siblingLaps.map((item) => {
    if (item.id === lap.id) return chartLap;
    const trimmed = applyLapTrimWithSession(
      {
        id: item.id,
        lap_number: item.lap_number,
        lap_time_ms: item.lap_time_ms,
        start_offset_sec: item.start_offset_sec,
        telemetry: item.telemetry,
        start_offset_override: item.start_offset_override,
        end_offset_override: item.end_offset_override,
      },
      siblingTrimables,
    );
    return {
      id: item.id,
      lap_number: item.lap_number,
      lap_time_ms: trimmed.lap_time_ms,
      start_offset_sec: trimmed.start_offset_sec,
      telemetry: trimmed.telemetry,
    };
  });

  const hasTrimOverride = Boolean(
    lap.start_offset_override != null || lap.end_offset_override != null,
  );

  const chartHeader =
    canEdit && onTrimChange && trimChart ? (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Speed chart
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="toolbar-trim"
              aria-pressed={trimOpen}
              onClick={() => setTrimOpen((open) => !open)}
              className={`apex-btn ${trimOpen || hasTrimOverride ? "apex-btn--pressed" : ""}`}
            >
              <span aria-hidden>✂</span> Trim
            </button>
          </div>
        </div>
        {trimDirty || videoDirty ? (
          <SectionSaveHint
            dirty
            saving={saving}
            label={
              trimDirty && videoDirty
                ? "Unsaved trim / video"
                : trimDirty
                  ? "Unsaved trim"
                  : "Unsaved video sync"
            }
            onSave={onSave}
            onDiscard={onDiscard}
          />
        ) : null}
        {trimOpen ? (
          <LapTrimControls
            lap={trimable}
            sessionMin={trimChart.sessionMin}
            sessionMax={trimChart.sessionMax}
            previewLapTimeMs={applied.lap_time_ms}
            canMergeNext={canMergeNext}
            canSplit={canSplit}
            busy={trimBusy}
            onChange={commitTrim}
            onReset={() => {
              onTrimReset?.(lap.id);
            }}
            onMergeNext={onMergeNext ? () => onMergeNext(lap.id) : undefined}
            onSplit={
              onSplit
                ? () => {
                    const b = resolveLapTrimBounds(trimable);
                    const mid = (b.effectiveStart + b.effectiveEnd) / 2;
                    const progress =
                      (mid - b.effectiveStart) /
                      Math.max(0.001, b.effectiveEnd - b.effectiveStart);
                    onSplit(lap.id, progress);
                  }
                : undefined
            }
          />
        ) : (
          <p className="text-[11px] text-zinc-600">
            Drag orange handles on the chart · tap Trim for numeric edit · Save
            when ready
          </p>
        )}
      </div>
    ) : null;

  const workspace = layout === "workspace";

  return (
    <section
      className={workspace ? "flex flex-col gap-2" : "space-y-4"}
      aria-label={`Lap ${lap.lap_number}`}
    >
      <div
        className={`flex flex-wrap items-end justify-between gap-2 ${
          workspace ? "" : "gap-3"
        }`}
      >
        <div>
          <h2
            className={`font-semibold tracking-tight text-zinc-50 ${
              workspace ? "text-sm" : "text-lg"
            }`}
          >
            Lap {lap.lap_number}
          </h2>
          <p
            className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-orange-400 ${
              workspace ? "text-lg" : "mt-0.5 text-2xl"
            }`}
          >
            {formatLapTime(applied.lap_time_ms)}
            {deltaSec === 0 ? (
              <span
                className="rounded-md border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-sans uppercase tracking-[0.16em] text-orange-400"
                data-apex-session-best="1"
              >
                Session best
              </span>
            ) : null}
          </p>
        </div>
        <div
          className={`flex flex-wrap items-center gap-2 text-zinc-500 ${
            workspace ? "text-xs" : "gap-3 text-sm"
          }`}
        >
          <span data-apex-peak-speed="1">
            Peak {formatSpeed(peak, speedUnit)}
          </span>
          {deltaSec == null ||
          deltaSec === 0 ||
          isLapExcluded(lap) ? null : (
            <span className="font-mono">Δ best {formatGap(deltaSec)}</span>
          )}
          {lap.excluded ? (
            <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              Excluded
            </span>
          ) : null}
        </div>
      </div>

      <div>
        <SyncedLapView
          sessionId={sessionId}
          layout={layout}
          sidebar={sidebar}
          extraToolTabs={extraToolTabs}
          toolsOpenRequest={toolsOpenRequest}
          toolsShowButtons={toolsShowButtons}
          mapHeader={mapHeader}
          chartHeader={chartHeader}
          lap={
            canEdit && onTrimChange
              ? {
                  id: lap.id,
                  lap_number: lap.lap_number,
                  lap_time_ms: applied.lap_time_ms,
                  start_offset_sec: applied.start_offset_sec,
                  telemetry: points,
                }
              : chartLap
          }
          chartOverride={
            canEdit && onTrimChange && trimChart
              ? {
                  points: trimChart.points,
                  trimMarkers: {
                    startT: trimChart.trimStartT,
                    endT: trimChart.trimEndT,
                  },
                }
              : undefined
          }
          siblingLaps={displaySiblingLaps}
          video={activeVideo}
          sessionStartedAtMs={sessionStartedAtMs}
          bestLapMs={bestMs ?? undefined}
          trackId={trackId}
          sfLine={sfLine}
          sfEditing={sfEditing}
          onSfEndpointMove={onSfEndpointMove}
          onVideoChange={onVideoChange}
          canEditSync={canEdit}
          onAttachYouTube={
            canEdit && onVideoChange
              ? async ({ youtubeId, youtubeUrl, title }) => {
                  const next: SessionVideo = {
                    id: activeVideo?.id ?? crypto.randomUUID(),
                    provider: "youtube",
                    youtubeId,
                    youtubeUrl,
                    title,
                    lapId: lap.id,
                    lapIndex: lap.lap_number,
                    offsetSec: 0,
                    rate: 1,
                    // Fresh paste starts unsynced until point-match Sync here.
                    syncSource: "unsynced",
                  };
                  onVideoChange(next);
                }
              : undefined
          }
          onTrimBoundaryDrag={
            canEdit && onTrimChange && trimChart
              ? (which, chartLocalT) => {
                  const sessionT =
                    trimChart.chartOriginSessionT + chartLocalT;
                  const next = clampTrimDrag(
                    which,
                    sessionT,
                    {
                      start: bounds.effectiveStart,
                      end: bounds.effectiveEnd,
                    },
                    {
                      min: trimChart.sessionMin,
                      max: trimChart.sessionMax,
                    },
                  );
                  const startOverride =
                    Math.abs(next.start - bounds.autoStart) < 0.0005
                      ? null
                      : next.start;
                  const endOverride =
                    Math.abs(next.end - bounds.autoEnd) < 0.0005
                      ? null
                      : next.end;
                  commitTrim({
                    start_offset_override: startOverride,
                    end_offset_override: endOverride,
                  });
                }
              : undefined
          }
        />
      </div>
    </section>
  );
}
