"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import {
  SessionToolsPanel,
  type SessionToolTab,
} from "@/components/SessionToolsPanel";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { compareChannelsForSeries } from "@/components/StackedTelemetry";
import { DualSessionVideos } from "@/components/video/DualSessionVideos";
import { useAnalysisMode } from "@/lib/analysis-mode";
import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import {
  COMPARE_COLORS,
  compareMany,
  defaultLapIds,
  defaultLapPair,
  hasGps,
  MAX_COMPARE_LAPS,
  parseCompareSlots,
  type MultiComparedPoint,
} from "@/lib/compare";
import { type CompareSessionOption } from "@/lib/compare-sessions";
import {
  comparisonItemsFromSlots,
  type ComparisonDraftSnapshot,
} from "@/lib/comparisons";
import { lapAsSyncLap } from "@/lib/dual-video-sync";
import { formatG, formatGap, formatLapTime } from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import { progressFromIndex } from "@/lib/scrub";
import { channelLabel } from "@/lib/telemetry-channels";
import { getTrack } from "@/lib/tracks";
import { pickSessionVideoForLap } from "@/lib/pick-session-video";
import type { LapRow, SessionVideo } from "@/lib/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type { CompareSessionOption };

type SlotState = {
  key: string;
  sessionId: string;
  lapId: string;
};

function pickVideoForLap(
  session: CompareSessionOption | null | undefined,
  lapId: string | undefined,
): SessionVideo | null {
  return pickSessionVideoForLap(session?.videos, lapId, { youtubeOnly: true });
}

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function findSessionForLap(
  sessions: CompareSessionOption[],
  lapId: string | undefined,
) {
  if (!lapId) return sessions[0] ?? null;
  return (
    sessions.find((session) => session.laps.some((lap) => lap.id === lapId)) ??
    null
  );
}

function newSlotKey() {
  return `slot-${Math.random().toString(36).slice(2, 9)}`;
}

function seedSlots(args: {
  sessions: CompareSessionOption[];
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
  initialLaps?: string;
  baseSessionId: string;
}): SlotState[] {
  const parsed = parseCompareSlots({
    ref: args.initialRef,
    other: args.initialOther,
    otherSession: args.initialOtherSession,
    laps: args.initialLaps,
    baseSessionId: args.baseSessionId,
  }).filter((slot) =>
    args.sessions.some(
      (session) =>
        session.id === slot.sessionId &&
        session.laps.some((lap) => lap.id === slot.lapId),
    ),
  );

  if (parsed.length >= 2) {
    return parsed.map((slot) => ({
      key: newSlotKey(),
      sessionId: slot.sessionId,
      lapId: slot.lapId,
    }));
  }

  const primary = args.sessions[0];
  if (!primary?.laps.length) return [];

  // Prefer fastest two from primary; fill from peers if needed.
  const ids = defaultLapIds(primary.laps, 2);
  const slots: SlotState[] = ids.map((lapId) => ({
    key: newSlotKey(),
    sessionId: primary.id,
    lapId,
  }));

  if (slots.length < 2) {
    for (const session of args.sessions) {
      if (slots.length >= 2) break;
      const pair = defaultLapPair(session.laps);
      const candidate = pair.ref;
      if (!candidate) continue;
      if (slots.some((s) => s.lapId === candidate && s.sessionId === session.id)) {
        continue;
      }
      slots.push({
        key: newSlotKey(),
        sessionId: session.id,
        lapId: candidate,
      });
    }
  }

  if (args.initialRef) {
    const refSession =
      findSessionForLap(args.sessions, args.initialRef) ?? primary;
    if (refSession.laps.some((lap) => lap.id === args.initialRef)) {
      slots[0] = {
        key: slots[0]?.key ?? newSlotKey(),
        sessionId: refSession.id,
        lapId: args.initialRef,
      };
    }
  }
  if (args.initialOther && slots[1]) {
    const otherSession =
      (args.initialOtherSession &&
        args.sessions.find((s) => s.id === args.initialOtherSession)) ||
      findSessionForLap(args.sessions, args.initialOther) ||
      args.sessions.find((s) => s.id !== slots[0].sessionId) ||
      primary;
    if (otherSession.laps.some((lap) => lap.id === args.initialOther)) {
      slots[1] = {
        key: slots[1].key,
        sessionId: otherSession.id,
        lapId: args.initialOther,
      };
    }
  }

  return slots.slice(0, MAX_COMPARE_LAPS);
}

export function LapCompare({
  laps,
  sessions,
  initialRef,
  initialOther,
  initialOtherSession,
  initialLaps,
  initialTrackId,
  initialRefIndex,
  initialAnalysisMode,
  readOnly,
  onDraftChange,
  extraToolTabs,
}: {
  laps: LapRow[];
  /** Sessions available for cross-session compare (own / friends / public / local). */
  sessions?: CompareSessionOption[];
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
  /** `sessionId:lapId,...` from URL. */
  initialLaps?: string;
  /** Prefer filtering pickers to this track when multiple tracks are present. */
  initialTrackId?: string;
  /** Override which seeded slot is the reference (saved comparisons). */
  initialRefIndex?: number;
  initialAnalysisMode?: GpsDisplayMode;
  /** Hide add/remove / set-ref when viewing a shared comparison read-only. */
  readOnly?: boolean;
  onDraftChange?: (draft: ComparisonDraftSnapshot) => void;
  /** Secondary panels (notes, corners) for the tools drawer. */
  extraToolTabs?: SessionToolTab[];
}) {
  const allSessions = useMemo<CompareSessionOption[]>(() => {
    if (sessions?.length) return sessions;
    return [
      {
        id: laps[0]?.session_id ?? "current",
        name: "This session",
        laps,
      },
    ];
  }, [sessions, laps]);

  const baseSessionId = allSessions[0]?.id ?? "current";

  const trackOptions = useMemo(() => {
    const ids = [
      ...new Set(
        allSessions
          .map((session) => session.trackId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return ids;
  }, [allSessions]);

  const [trackFilter, setTrackFilter] = useState(() => {
    if (initialTrackId && trackOptions.includes(initialTrackId)) {
      return initialTrackId;
    }
    return trackOptions[0] ?? "";
  });

  useEffect(() => {
    if (!trackOptions.length) {
      setTrackFilter("");
      return;
    }
    if (trackFilter && trackOptions.includes(trackFilter)) return;
    if (initialTrackId && trackOptions.includes(initialTrackId)) {
      setTrackFilter(initialTrackId);
      return;
    }
    setTrackFilter(trackOptions[0] ?? "");
  }, [trackOptions, trackFilter, initialTrackId]);

  const filteredSessions = useMemo(() => {
    if (!trackFilter) return allSessions;
    const matched = allSessions.filter(
      (session) => !session.trackId || session.trackId === trackFilter,
    );
    return matched.length ? matched : allSessions;
  }, [allSessions, trackFilter]);

  const [slots, setSlots] = useState<SlotState[]>(() =>
    seedSlots({
      sessions: filteredSessions,
      initialRef,
      initialOther,
      initialOtherSession,
      initialLaps,
      baseSessionId,
    }),
  );
  /** Index into `slots` that is the reference (delta baseline). */
  const [refIndex, setRefIndex] = useState(() => {
    if (
      initialRefIndex != null &&
      Number.isFinite(initialRefIndex) &&
      initialRefIndex >= 0
    ) {
      return Math.floor(initialRefIndex);
    }
    return 0;
  });

  // Keep slots valid when session list / filter changes (bail if unchanged).
  useEffect(() => {
    setSlots((prev) => {
      if (!filteredSessions.length) return prev;
      const next = prev
        .map((slot) => {
          const session =
            filteredSessions.find((s) => s.id === slot.sessionId) ??
            filteredSessions[0];
          if (!session) return null;
          const lap =
            session.laps.find((item) => item.id === slot.lapId) ??
            session.laps[0];
          if (!lap) return null;
          return { ...slot, sessionId: session.id, lapId: lap.id };
        })
        .filter((slot): slot is SlotState => slot != null);

      const resolvedSlots =
        next.length >= 2
          ? next.slice(0, MAX_COMPARE_LAPS)
          : seedSlots({
              sessions: filteredSessions,
              initialRef,
              initialOther,
              initialOtherSession,
              initialLaps,
              baseSessionId: filteredSessions[0]?.id ?? baseSessionId,
            });

      const same =
        resolvedSlots.length === prev.length &&
        resolvedSlots.every(
          (slot, i) =>
            slot.sessionId === prev[i]?.sessionId &&
            slot.lapId === prev[i]?.lapId &&
            slot.key === prev[i]?.key,
        );
      return same ? prev : resolvedSlots;
    });
  }, [
    filteredSessions,
    initialRef,
    initialOther,
    initialOtherSession,
    initialLaps,
    baseSessionId,
  ]);

  useEffect(() => {
    if (refIndex >= slots.length) setRefIndex(0);
  }, [refIndex, slots.length]);

  type ResolvedSlot = {
    slot: SlotState;
    index: number;
    session: CompareSessionOption;
    lap: LapRow;
    color: string;
    isRef: boolean;
  };

  const resolved = useMemo((): ResolvedSlot[] => {
    const out: ResolvedSlot[] = [];
    slots.forEach((slot, index) => {
      const session =
        filteredSessions.find((s) => s.id === slot.sessionId) ?? null;
      const lap = session?.laps.find((item) => item.id === slot.lapId) ?? null;
      if (!session || !lap) return;
      out.push({
        slot,
        index,
        session,
        lap,
        color: COMPARE_COLORS[index % COMPARE_COLORS.length] ?? COMPARE_COLORS[0],
        isRef: index === refIndex,
      });
    });
    return out;
  }, [slots, filteredSessions, refIndex]);

  // Reorder so reference is first for map/charts/video (color follows slot index).
  const ordered = useMemo((): ResolvedSlot[] => {
    if (!resolved.length) return [];
    const ref = resolved.find((item) => item.isRef) ?? resolved[0];
    const others = resolved.filter((item) => item.lap.id !== ref.lap.id);
    return [ref, ...others];
  }, [resolved]);

  const uniqueLapIds = new Set(ordered.map((item) => item.lap.id));
  const sameLap = ordered.length >= 2 && uniqueLapIds.size < 2;

  const centerline = useMemo(() => {
    const sampleLaps = ordered.map((item) => item.lap.telemetry);
    for (const session of filteredSessions) {
      for (const lap of session.laps) sampleLaps.push(lap.telemetry);
    }
    return resolveTrackCenterline(trackFilter || undefined, null, sampleLaps);
  }, [trackFilter, ordered, filteredSessions]);

  const matchedByLapId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof mapMatchLap>>();
    for (const item of ordered) {
      map.set(item.lap.id, mapMatchLap(item.lap.telemetry, centerline));
    }
    return map;
  }, [ordered, centerline]);

  const [gpsMode, setGpsMode] = useState<GpsDisplayMode>("snapped");
  const {
    mode: analysisMode,
    setMode: setAnalysisMode,
    hasSnap: hasAnalysisSnap,
  } = useAnalysisMode(Boolean(centerline));

  useEffect(() => {
    if (initialAnalysisMode === "raw" || initialAnalysisMode === "snapped") {
      setAnalysisMode(initialAnalysisMode);
    }
  }, [initialAnalysisMode, setAnalysisMode]);

  const series: MultiComparedPoint[] = useMemo(() => {
    if (ordered.length < 2 || sameLap) return [];
    const ref = ordered[0];
    const others = ordered.slice(1);
    return compareMany(
      analysisPoints(
        matchedByLapId.get(ref.lap.id) ?? null,
        ref.lap.telemetry,
        analysisMode,
      ),
      others.map((item) =>
        analysisPoints(
          matchedByLapId.get(item.lap.id) ?? null,
          item.lap.telemetry,
          analysisMode,
        ),
      ),
    );
  }, [ordered, sameLap, matchedByLapId, analysisMode]);

  const stackedChannels = useMemo(
    () => compareChannelsForSeries(series, ordered.length),
    [series, ordered.length],
  );

  const mapTraces = useMemo(() => {
    return ordered.map((item) => ({
      id: item.lap.id,
      label: `Lap ${item.lap.lap_number}`,
      color: item.color,
      points: enrichTelemetry(
        displayPoints(
          matchedByLapId.get(item.lap.id) ?? null,
          item.lap.telemetry,
          centerline ? gpsMode : "raw",
        ),
      ),
    }));
  }, [ordered, matchedByLapId, gpsMode, centerline]);

  const [progress, setProgress] = useState<number | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const displayProgress = previewProgress ?? progress;

  const draftKey = resolved
    .map((item) => `${item.session.id}:${item.lap.id}:${item.isRef ? "r" : ""}`)
    .join("|");
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (!onDraftChange) return;
    const items = comparisonItemsFromSlots(
      resolved.map((item) => ({
        sessionId: item.session.id,
        lapId: item.lap.id,
        lapNumber: item.lap.lap_number,
        color: item.color,
      })),
    );
    const refInItems = Math.max(
      0,
      resolved.findIndex((item) => item.isRef),
    );
    onDraftChange({
      items,
      referenceIndex: refInItems >= 0 ? refInItems : 0,
      analysisMode,
      progress: progressRef.current,
    });
    // Intentionally omit progress — scrubbing must not re-emit draft / re-render parents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDraftChange, draftKey, analysisMode]);

  const hoverAt =
    displayProgress == null || series.length < 2
      ? null
      : Math.round(displayProgress * (series.length - 1));

  const previewFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(progressFromIndex(next, series.length));
    },
    [series.length],
  );
  const seekFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(null);
      setProgress(progressFromIndex(next, series.length));
    },
    [series.length],
  );
  const chartScrub = bindChartScrub(series.length, {
    onPreviewIndex: previewFromChart,
    onSeekIndex: seekFromChart,
  });
  const onChartMouseMove = useCallback(
    (state: Parameters<typeof hoverIndex>[0]) => {
      const index = hoverIndex(state);
      if (isSeekPointer(state)) seekFromChart(index);
      else previewFromChart(index);
    },
    [previewFromChart, seekFromChart],
  );

  const showMap = ordered.some((item) => hasGps(item.lap.telemetry));
  const multiSession = filteredSessions.length > 1;
  const totalLaps = filteredSessions.reduce(
    (sum, session) => sum + session.laps.length,
    0,
  );

  function updateSlot(key: string, patch: Partial<SlotState>) {
    setSlots((prev) =>
      prev.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    );
  }

  function addSlot() {
    if (slots.length >= MAX_COMPARE_LAPS) return;
    const used = new Set(slots.map((s) => `${s.sessionId}:${s.lapId}`));
    let session = filteredSessions[0];
    let lapId = "";
    for (const candidate of filteredSessions) {
      const ordered = [...candidate.laps].sort(
        (a, b) => a.lap_time_ms - b.lap_time_ms,
      );
      // Prefer non-excluded for default picks; fall back so excluded stay selectable.
      const pool = [
        ...ordered.filter((lap) => !lap.excluded),
        ...ordered.filter((lap) => lap.excluded),
      ];
      for (const lap of pool) {
        const key = `${candidate.id}:${lap.id}`;
        if (used.has(key)) continue;
        session = candidate;
        lapId = lap.id;
        break;
      }
      if (lapId) break;
    }
    if (!session || !lapId) return;
    setSlots((prev) => [
      ...prev,
      { key: newSlotKey(), sessionId: session!.id, lapId },
    ]);
  }

  function removeSlot(key: string) {
    if (slots.length <= 2) return;
    const index = slots.findIndex((slot) => slot.key === key);
    setSlots((prev) => prev.filter((slot) => slot.key !== key));
    if (index >= 0 && index === refIndex) setRefIndex(0);
    else if (index >= 0 && index < refIndex) setRefIndex((r) => r - 1);
  }

  if (totalLaps < 2) {
    return (
      <p className="text-sm text-zinc-500">
        Need at least two laps to compare. Upload another session or open a
        friends/public session on this track.
      </p>
    );
  }

  const videoSides = ordered.map((item) => ({
    lap: lapAsSyncLap(item.lap),
    video: pickVideoForLap(item.session, item.lap.id),
    label:
      item.session.name !== "This session"
        ? `${item.session.name} · L${item.lap.lap_number}`
        : `Lap ${item.lap.lap_number}`,
    color: item.color,
  }));

  const setupPanel = (
    <div className="space-y-2.5">
      {trackOptions.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            Track
          </span>
          <select
            value={trackFilter}
            onChange={(event) => setTrackFilter(event.target.value)}
            className="min-h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          >
            {trackOptions.map((trackId) => (
              <option key={trackId} value={trackId}>
                {getTrack(trackId)?.name ?? trackId}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Laps ({slots.length}/{MAX_COMPARE_LAPS})
          {readOnly ? " · read-only" : ""}
        </p>
        {!readOnly ? (
          <button
            type="button"
            disabled={slots.length >= MAX_COMPARE_LAPS}
            onClick={addSlot}
            className="min-h-8 rounded-md border border-zinc-800 px-2.5 text-xs text-zinc-300 hover:border-zinc-600 disabled:opacity-40"
          >
            Add lap
          </button>
        ) : null}
      </div>
      <div className="grid gap-2">
        {slots.map((slot, index) => {
          const session =
            filteredSessions.find((s) => s.id === slot.sessionId) ??
            filteredSessions[0];
          const color = COMPARE_COLORS[index % COMPARE_COLORS.length];
          const isRef = index === refIndex;
          return (
            <div
              key={slot.key}
              className="space-y-1.5 rounded-lg border border-zinc-800/80 bg-zinc-950/40 px-2 py-2"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  {isRef ? "Reference" : `Lap ${index + 1}`}
                </span>
                {!readOnly ? (
                  <div className="ml-auto flex gap-1">
                    {!isRef ? (
                      <button
                        type="button"
                        onClick={() => setRefIndex(index)}
                        className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-orange-400 hover:bg-zinc-900"
                      >
                        Set ref
                      </button>
                    ) : null}
                    {slots.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.key)}
                        className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-zinc-600">
                    {session?.name ?? ""}
                  </span>
                )}
              </div>
              {multiSession && !readOnly ? (
                <SessionSelect
                  label="Session"
                  value={session?.id ?? ""}
                  sessions={filteredSessions}
                  onChange={(id) => {
                    const next = filteredSessions.find((s) => s.id === id);
                    const pair = defaultLapPair(next?.laps ?? []);
                    updateSlot(slot.key, {
                      sessionId: id,
                      lapId: pair.ref,
                    });
                  }}
                />
              ) : null}
              {!readOnly ? (
                <LapChipPicker
                  value={slot.lapId}
                  laps={session?.laps ?? []}
                  onChange={(lapId) => updateSlot(slot.key, { lapId })}
                />
              ) : (
                <p className="text-sm text-zinc-300">
                  Lap{" "}
                  {session?.laps.find((l) => l.id === slot.lapId)?.lap_number ??
                    "—"}{" "}
                  <span className="font-mono text-zinc-500">
                    {formatLapTime(
                      session?.laps.find((l) => l.id === slot.lapId)
                        ?.lap_time_ms ?? 0,
                    )}
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      <SessionToolsPanel
        tabs={[
          { id: "setup", label: "Laps", content: setupPanel },
          ...(extraToolTabs ?? []),
        ]}
        defaultTab="setup"
        defaultOpen
      />

      {sameLap || ordered.length < 2 ? (
        <p className="text-sm text-zinc-500">
          Pick at least two different laps (open Tools → Laps).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                vs reference
              </p>
              <p className="font-mono text-lg text-zinc-50 sm:text-xl">
                {ordered
                  .slice(1)
                  .map((item) =>
                    formatGap(
                      (item.lap.lap_time_ms - ordered[0].lap.lap_time_ms) /
                        1000,
                    ),
                  )
                  .join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
              {ordered.map((item) => (
                <p
                  key={item.lap.id}
                  className="flex flex-wrap items-center gap-1.5"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.isRef ? (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                      ref
                    </span>
                  ) : null}
                  Lap {item.lap.lap_number}{" "}
                  <span className="font-mono text-zinc-200">
                    {formatLapTime(item.lap.lap_time_ms)}
                  </span>
                </p>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.25fr)] lg:items-start">
            <aside className="flex min-h-[180px] flex-col">
              {showMap ? (
                <TrackMap
                  traces={mapTraces}
                  activeProgress={progress}
                  previewProgress={previewProgress}
                  onPreviewProgress={setPreviewProgress}
                  onProgress={(next) => {
                    setPreviewProgress(null);
                    setProgress(next);
                  }}
                  centerline={centerline}
                  gpsMode={centerline ? gpsMode : undefined}
                  onGpsModeChange={centerline ? setGpsMode : undefined}
                  analysisMode={centerline ? analysisMode : undefined}
                  onAnalysisModeChange={
                    centerline ? setAnalysisMode : undefined
                  }
                  analysisDisabled={!hasAnalysisSnap}
                  defaultFollowId={ordered[0]?.lap.id}
                  compact
                />
              ) : (
                <div className="flex items-center">
                  <MissingGps />
                </div>
              )}
            </aside>

            <div className="flex flex-col gap-2">
              <div>
                <DualSessionVideos
                  sides={videoSides}
                  progress={progress}
                  onProgress={(next) => {
                    setPreviewProgress(null);
                    setProgress(next);
                  }}
                  compact
                />
              </div>
              <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Telemetry · all channels
              </p>

              {stackedChannels.includes("speed") ? (
                <ChartCard
                  title="Speed"
                  hint={
                    analysisMode === "snapped"
                      ? "Aligned on snapped track distance"
                      : "Aligned on raw GPS path"
                  }
                  scrub={chartScrub}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} unit=" km/h" width={48} />
                      <Tooltip content={<CompareTooltip />} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`speed${index}`}
                          name={`Lap ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("delta") ? (
                <ChartCard
                  title="Delta"
                  hint={
                    analysisMode === "snapped"
                      ? "Snapped · positive means behind reference"
                      : "Raw · positive means behind reference"
                  }
                  scrub={chartScrub}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} unit=" s" width={48} />
                      <Tooltip content={<CompareTooltip mode="delta" />} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      <ReferenceLine y={0} stroke="#52525b" />
                      {ordered.slice(1).map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`delta${index + 1}`}
                          name={`Δ Lap ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("throttleBrake") ? (
                <ChartCard title={channelLabel("throttleBrake")} hint="0–100%" scrub={chartScrub}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={`${item.lap.id}-th`}
                          type="monotone"
                          dataKey={`throttle${index}`}
                          name={`T ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                      {ordered.map((item, index) => (
                        <Line
                          key={`${item.lap.id}-br`}
                          type="monotone"
                          dataKey={`brake${index}`}
                          name={`B ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("steering") ? (
                <ChartCard title={channelLabel("steering")} hint="degrees" scrub={chartScrub}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`steering${index}`}
                          name={`Lap ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("g") ? (
                <ChartCard title="G" hint="Combined acceleration" scrub={chartScrub}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={40} />
                      <Tooltip content={<CompareTooltip mode="g" />} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`g${index}`}
                          name={`Lap ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("gearRpm") ? (
                <ChartCard title={channelLabel("gearRpm")} scrub={chartScrub}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`rpm${index}`}
                          name={`RPM ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}

              {stackedChannels.includes("heading") ? (
                <ChartCard title={channelLabel("heading")} hint="degrees" scrub={chartScrub}>
                  <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey="dist"
                        type="number"
                        tickFormatter={(value) => formatDistance(Number(value))}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={series[hoverAt]?.dist}
                          stroke="#a1a1aa"
                          strokeDasharray="4 4"
                        />
                      ) : null}
                      {ordered.map((item, index) => (
                        <Line
                          key={item.lap.id}
                          type="monotone"
                          dataKey={`heading${index}`}
                          name={`Lap ${item.lap.lap_number}`}
                          stroke={item.color}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SessionSelect({
  label,
  value,
  sessions,
  onChange,
}: {
  label: string;
  value: string;
  sessions: CompareSessionOption[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-1"
      >
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name}
            {session.sourceKind === "gopro" || session.gpsQuality?.rank
              ? session.gpsQuality?.stream
                ? ` · ${session.gpsQuality.stream}`
                : " · GoPro"
              : ""}
            {session.kind === "upload" ? " · you" : ""}
            {session.kind === "friends" ? " · friends" : ""}
            {session.kind === "demo" ? " · demo" : ""}
            {session.kind === "public" ? " · public" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Compact searchable lap chips for compare setup. */
function LapChipPicker({
  value,
  laps,
  onChange,
}: {
  value: string;
  laps: LapRow[];
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const ordered = useMemo(
    () => [...laps].sort((a, b) => a.lap_number - b.lap_number),
    [laps],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((lap) => {
      const time = formatLapTime(lap.lap_time_ms).toLowerCase();
      return (
        String(lap.lap_number).includes(q) ||
        time.includes(q) ||
        `lap ${lap.lap_number}`.includes(q)
      );
    });
  }, [ordered, query]);

  return (
    <div className="space-y-1.5">
      {ordered.length > 6 ? (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search laps…"
          className="min-h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-100 outline-none ring-orange-500/40 placeholder:text-zinc-600 focus:border-orange-500/70 focus:ring-1"
        />
      ) : null}
      <div
        className="flex flex-wrap gap-1"
        role="listbox"
        aria-label="Lap"
      >
        {filtered.map((lap) => {
          const selected = lap.id === value;
          return (
            <button
              key={lap.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(lap.id)}
              className={`inline-flex min-h-7 items-center gap-1 rounded-md px-2 font-mono text-[11px] ${
                selected
                  ? "bg-orange-500 text-black"
                  : "border border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:text-zinc-50"
              } ${lap.excluded ? "opacity-50" : ""}`}
            >
              L{lap.lap_number}
              <span className={selected ? "text-black/70" : "text-zinc-500"}>
                {formatLapTime(lap.lap_time_ms)}
              </span>
            </button>
          );
        })}
        {!filtered.length ? (
          <p className="text-xs text-zinc-500">No laps match.</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Fixed plot height so Recharts ResponsiveContainer never collapses to 0.
 */
function ChartCard({
  title,
  hint,
  children,
  scrub,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  scrub?: ReturnType<typeof bindChartScrub>;
}) {
  return (
    <div
      className="max-w-full shrink-0 overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-2.5 py-2"
      data-apex-compare-chart
    >
      <div className="mb-1 flex shrink-0 items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {title}
        </p>
        <p className="truncate font-mono text-[10px] text-zinc-600">{hint}</p>
      </div>
      <div
        className="relative h-[120px] min-h-[120px] touch-none sm:h-[140px] sm:min-h-[140px]"
        data-apex-chart-plot="compare"
        style={{ minHeight: 120 }}
        {...scrub}
      >
        <div className="absolute inset-0 min-h-0">{children}</div>
      </div>
    </div>
  );
}

function CompareTooltip({
  active,
  payload,
  label,
  mode = "speed",
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: number;
  mode?: "speed" | "delta" | "g";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100">
      <p className="mb-1 text-zinc-500">{formatDistance(Number(label))}</p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}:{" "}
          {mode === "delta"
            ? formatGap(Number(item.value))
            : mode === "g"
              ? formatG(Number(item.value))
              : `${Number(item.value).toFixed(0)} km/h`}
        </p>
      ))}
    </div>
  );
}
