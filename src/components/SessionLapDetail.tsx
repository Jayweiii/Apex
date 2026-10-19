"use client";

import { ExcludeFromBestControl } from "@/components/ExcludeFromBestControl";
import type { LapExcludeChange } from "@/components/LapList";
import { LapTrimControls } from "@/components/LapTrimControls";
import { SyncedLapView } from "@/components/video/SyncedLapView";
import { formatLapTime } from "@/lib/format";
import {
  applyLapTrim,
  resolveLapTrimBounds,
  type TrimableLap,
} from "@/lib/lap-trim";
import { bestLapTimeMs, suspicionByLapId } from "@/lib/lap-quality";
import { pickSessionVideoForLap } from "@/lib/pick-session-video";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { useMemo, useState } from "react";

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
  onExcludeChange,
  excludeBusy = false,
  onTrimChange,
  onTrimReset,
  onMergeNext,
  onSplit,
  trimBusy = false,
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
}) {
  const [draftTrim, setDraftTrim] = useState<{
    start_offset_override: number | null;
    end_offset_override: number | null;
  } | null>(null);

  const trimable: TrimableLap = useMemo(
    () => ({
      id: lap.id,
      lap_number: lap.lap_number,
      lap_time_ms: lap.lap_time_ms,
      start_offset_sec: lap.start_offset_sec,
      telemetry: lap.telemetry,
      start_offset_override:
        draftTrim?.start_offset_override ?? lap.start_offset_override ?? null,
      end_offset_override:
        draftTrim?.end_offset_override ?? lap.end_offset_override ?? null,
    }),
    [lap, draftTrim],
  );

  const applied = useMemo(() => applyLapTrim(trimable), [trimable]);
  const bounds = applied.bounds;
  const points = applied.telemetry;
  const peak = points.reduce((max, point) => Math.max(max, point.speed), 0);

  const siblingForBest = useMemo(
    () =>
      siblingLaps.map((item) => {
        if (item.id !== lap.id) {
          const trimmed = applyLapTrim({
            id: item.id,
            lap_number: item.lap_number,
            lap_time_ms: item.lap_time_ms,
            start_offset_sec: item.start_offset_sec,
            telemetry: item.telemetry,
            start_offset_override: item.start_offset_override,
            end_offset_override: item.end_offset_override,
          });
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
    [siblingLaps, lap, applied.lap_time_ms],
  );

  const bestMs = bestLapTimeMs(siblingForBest);
  const deltaSec =
    bestMs != null ? (applied.lap_time_ms - bestMs) / 1000 : null;

  const flags = suspicionByLapId(siblingLaps);
  const suspicion = flags.get(lap.id);

  const activeVideo: SessionVideo | null = useMemo(
    () =>
      pickSessionVideoForLap(videos, lap.id, {
        videoId: videoParam,
        youtubeOnly: true,
      }),
    [videos, videoParam, lap.id],
  );

  // Full auto telemetry for trim drag markers (lap-local seconds).
  const autoTelemetry = lap.telemetry;
  const trimMarkers =
    canEdit && onTrimChange && autoTelemetry.length >= 2
      ? {
          startT: Math.max(0, bounds.effectiveStart - bounds.autoStart),
          endT: Math.max(
            0.1,
            bounds.effectiveEnd - bounds.autoStart,
          ),
        }
      : null;

  function commitTrim(next: {
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) {
    setDraftTrim(next);
    onTrimChange?.({
      lapId: lap.id,
      ...next,
    });
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

  // When editing trim, charts use full auto series so markers are visible;
  // playback/map use applied trim for live recompute.
  const chartLap = canEdit && onTrimChange
    ? {
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: Math.round((bounds.autoEnd - bounds.autoStart) * 1000),
        start_offset_sec: bounds.autoStart,
        telemetry: autoTelemetry,
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
    const trimmed = applyLapTrim({
      id: item.id,
      lap_number: item.lap_number,
      lap_time_ms: item.lap_time_ms,
      start_offset_sec: item.start_offset_sec,
      telemetry: item.telemetry,
      start_offset_override: item.start_offset_override,
      end_offset_override: item.end_offset_override,
    });
    return {
      id: item.id,
      lap_number: item.lap_number,
      lap_time_ms: trimmed.lap_time_ms,
      start_offset_sec: trimmed.start_offset_sec,
      telemetry: trimmed.telemetry,
    };
  });

  return (
    <section className="space-y-4" aria-label={`Lap ${lap.lap_number}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Lap {lap.lap_number}
          </h2>
          <p className="mt-0.5 font-mono text-2xl text-orange-400">
            {formatLapTime(applied.lap_time_ms)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          <span>Peak {peak.toFixed(0)} km/h</span>
          {deltaSec == null ? null : deltaSec !== 0 ? (
            <span className="font-mono">
              Δ best {deltaSec > 0 ? "+" : ""}
              {deltaSec.toFixed(3)}s
            </span>
          ) : (
            <span className="text-orange-500/90">Best</span>
          )}
          {canEdit && onExcludeChange ? (
            <ExcludeFromBestControl
              excluded={Boolean(lap.excluded)}
              busy={excludeBusy}
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
                      : (next.exclude_reason ?? "manual")
                    : null,
                });
              }}
            />
          ) : null}
        </div>
      </div>

      {canEdit && onTrimChange ? (
        <LapTrimControls
          lap={trimable}
          previewLapTimeMs={applied.lap_time_ms}
          canMergeNext={canMergeNext}
          canSplit={canSplit}
          busy={trimBusy}
          onChange={commitTrim}
          onReset={() => {
            setDraftTrim({
              start_offset_override: null,
              end_offset_override: null,
            });
            onTrimReset?.(lap.id);
          }}
          onMergeNext={
            onMergeNext ? () => onMergeNext(lap.id) : undefined
          }
          onSplit={
            onSplit
              ? () => {
                  const b = resolveLapTrimBounds(trimable);
                  const mid =
                    (b.effectiveStart + b.effectiveEnd) / 2;
                  const progress =
                    (mid - b.effectiveStart) /
                    Math.max(0.001, b.effectiveEnd - b.effectiveStart);
                  onSplit(lap.id, progress);
                }
              : undefined
          }
        />
      ) : null}

      <SyncedLapView
        sessionId={sessionId}
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
        siblingLaps={displaySiblingLaps}
        video={activeVideo}
        sessionStartedAtMs={sessionStartedAtMs}
        bestLapMs={bestMs ?? undefined}
        trackId={trackId}
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
                  // Fresh paste starts unsynced until Mark start line.
                  syncSource: "unsynced",
                };
                onVideoChange(next);
              }
            : undefined
        }
        trimMarkers={
          canEdit && onTrimChange && trimMarkers
            ? // Markers are on auto chart — when showing applied telemetry,
              // map markers to applied window ends (0 .. duration).
              { startT: 0, endT: applied.lap_time_ms / 1000 }
            : undefined
        }
        onTrimBoundaryDrag={
          canEdit && onTrimChange
            ? (which, lapLocalT) => {
                // Drag is relative to applied view: convert to session time.
                const sessionT = applied.start_offset_sec + lapLocalT;
                if (which === "start") {
                  commitTrim({
                    start_offset_override: sessionT,
                    end_offset_override:
                      trimable.end_offset_override ??
                      (Math.abs(bounds.effectiveEnd - bounds.autoEnd) < 0.0005
                        ? null
                        : bounds.effectiveEnd),
                  });
                } else {
                  commitTrim({
                    start_offset_override:
                      trimable.start_offset_override ??
                      (Math.abs(bounds.effectiveStart - bounds.autoStart) <
                      0.0005
                        ? null
                        : bounds.effectiveStart),
                    end_offset_override: sessionT,
                  });
                }
              }
            : undefined
        }
      />
    </section>
  );
}
