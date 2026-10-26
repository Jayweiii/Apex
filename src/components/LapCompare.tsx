"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import {
  HoverCursorLine,
  HoverCursorScope,
  PlaybackCursorLine,
} from "@/components/HoverCursor";
import { createHoverCursorController } from "@/components/hover-cursor";
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
  compareManyByTime,
  defaultLapIds,
  defaultLapPair,
  hasGps,
  MAX_COMPARE_LAPS,
  parseCompareSlots,
  sharedCompareDurationMs,
  type CompareAxis,
  type MultiComparedPoint,
} from "@/lib/compare";
import {
  formatSessionPickerLabel,
  type CompareSessionOption,
} from "@/lib/compare-sessions";
import {
  comparisonItemsFromSlots,
  type ComparisonDraftSnapshot,
} from "@/lib/comparisons";
import { lapAsSyncLap } from "@/lib/dual-video-sync";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import {
  formatClock,
  formatG,
  formatGap,
  formatLapTime,
  kmhToDisplay,
  speedUnitSuffix,
} from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import { bestLapTimeMs, isLapExcluded } from "@/lib/lap-quality";
import { lapKindsForSession } from "@/lib/lap-sf-boundary";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import {
  indexNearestTime,
  plotFractionFromTime,
  progressFromTimeSec,
  timeSecFromProgress,
} from "@/lib/playback-timebase";
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
  /** Once the user toggles laps, never reseed from URL/defaults. */
  const userTouchedSlotsRef = useRef(false);
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

  /** Session currently shown in the always-visible lap list (selections persist). */
  const [browseSessionId, setBrowseSessionId] = useState(
    () => filteredSessions[0]?.id ?? baseSessionId,
  );

  // Keep slots valid when session list / filter changes (bail if unchanged).
  // Never overwrite after the user has clicked — late session loads used to
  // reseed L10/L11 from URL and clobber early picker clicks.
  useEffect(() => {
    setSlots((prev) => {
      if (!filteredSessions.length) return prev;

      if (userTouchedSlotsRef.current) {
        // Remap only when a chosen lap still exists; never fall back to laps[0].
        const kept = prev
          .map((slot) => {
            const session = filteredSessions.find((s) => s.id === slot.sessionId);
            if (!session) return null;
            const lap = session.laps.find((item) => item.id === slot.lapId);
            if (!lap) return null;
            return slot;
          })
          .filter((slot): slot is SlotState => slot != null);
        return kept.length >= 2 ? kept.slice(0, MAX_COMPARE_LAPS) : prev;
      }

      const next = prev
        .map((slot) => {
          const session = filteredSessions.find((s) => s.id === slot.sessionId);
          if (!session) return null;
          const lap = session.laps.find((item) => item.id === slot.lapId);
          // Do not substitute laps[0] — that races URL preselection.
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

  const activeBrowseSessionId = filteredSessions.some(
    (session) => session.id === browseSessionId,
  )
    ? browseSessionId
    : (filteredSessions[0]?.id ?? browseSessionId);

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

  const [speedUnit] = useSpeedUnit();
  const speedUnitLabel = speedUnitSuffix(speedUnit);

  const [chartAxis, setChartAxis] = useState<CompareAxis>("time");
  const sharedMs = useMemo(
    () =>
      sharedCompareDurationMs(
        ...ordered.map((item) => item.lap.lap_time_ms),
      ),
    [ordered],
  );
  const sharedSec = sharedMs / 1000;

  const series: MultiComparedPoint[] = useMemo(() => {
    if (ordered.length < 2 || sameLap) return [];
    const ref = ordered[0];
    const others = ordered.slice(1);
    const refPts = analysisPoints(
      matchedByLapId.get(ref.lap.id) ?? null,
      ref.lap.telemetry,
      analysisMode,
    );
    const otherPts = others.map((item) =>
      analysisPoints(
        matchedByLapId.get(item.lap.id) ?? null,
        item.lap.telemetry,
        analysisMode,
      ),
    );
    // Default: time-aligned (same elapsed ms). Distance toggle kept for analysis.
    return chartAxis === "time"
      ? compareManyByTime(refPts, otherPts, 180, sharedMs)
      : compareMany(refPts, otherPts);
  }, [ordered, sameLap, matchedByLapId, analysisMode, chartAxis, sharedMs]);

  const xKey = chartAxis === "time" ? "t" : "dist";
  const formatXTick = useCallback(
    (value: number) =>
      chartAxis === "time"
        ? formatClock(Number(value))
        : formatDistance(Number(value)),
    [chartAxis],
  );

  /** Speed channels converted for the preferred unit (telemetry stays km/h). */
  const speedSeries = useMemo(
    () =>
      series.map((row) => {
        const next: MultiComparedPoint = { ...row };
        const speeds = next as MultiComparedPoint & Record<string, number>;
        for (let i = 0; i < ordered.length; i += 1) {
          const key = `speed${i}`;
          const raw = speeds[key];
          if (typeof raw === "number") {
            speeds[key] = kmhToDisplay(raw, speedUnit);
          }
        }
        return next;
      }),
    [series, ordered.length, speedUnit],
  );

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
  const [playing, setPlaying] = useState(false);
  const [progressSubscribe, setProgressSubscribe] = useState<
    ((listener: (progress: number) => void) => () => void) | null
  >(null);
  const hoverEnabled = !playing;

  const hoverController = useMemo(() => createHoverCursorController(), []);
  useEffect(() => () => hoverController.dispose(), [hoverController]);

  useEffect(() => {
    if (hoverEnabled) return;
    setPreviewProgress(null);
  }, [hoverEnabled]);

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

  const progressFromSeriesIndex = useCallback(
    (index: number | null) => {
      if (index == null || series.length < 2) return null;
      const row = series[Math.min(series.length - 1, Math.max(0, index))];
      if (!row) return null;
      if (chartAxis === "time") {
        const t = typeof row.t === "number" ? row.t : 0;
        return progressFromTimeSec(t, sharedSec, 0);
      }
      return Math.min(1, Math.max(0, index / (series.length - 1)));
    },
    [series, chartAxis, sharedSec],
  );

  // Dashed Recharts ReferenceLine is hover-only. While playing, the solid
  // PlaybackCursorLine is the sole cursor — using progress here drew a stray
  // second dashed line beside it.
  const hoverAt =
    !hoverEnabled ||
    previewProgress == null ||
    series.length < 2
      ? null
      : chartAxis === "time"
        ? indexNearestTime(
            series.map((row) => ({ t: typeof row.t === "number" ? row.t : 0 })),
            timeSecFromProgress(previewProgress, sharedSec, 0),
          )
        : Math.round(previewProgress * (series.length - 1));

  // Drive DOM playback cursor from shared progress (throttled React or rAF subscribe).
  useEffect(() => {
    const apply = (p: number | null) => {
      if (p == null || series.length < 2) {
        hoverController.setPlaybackFraction(null);
        hoverController.setPlaybackIndex(null);
        return;
      }
      if (chartAxis === "time") {
        const targetT = timeSecFromProgress(p, sharedSec, 0);
        const firstT = typeof series[0]?.t === "number" ? series[0].t : 0;
        const lastT =
          typeof series[series.length - 1]?.t === "number"
            ? (series[series.length - 1]!.t as number)
            : sharedSec;
        hoverController.setPlaybackFraction(
          plotFractionFromTime(targetT, firstT, lastT),
        );
        hoverController.setPlaybackIndex(
          indexNearestTime(
            series.map((row) => ({ t: typeof row.t === "number" ? row.t : 0 })),
            targetT,
          ),
        );
        return;
      }
      hoverController.setPlaybackFraction(p);
      hoverController.setPlaybackIndex(
        Math.round(p * (series.length - 1)),
      );
    };
    apply(progress);
    if (!playing || !progressSubscribe) return;
    return progressSubscribe((p) => apply(p));
  }, [
    progress,
    playing,
    progressSubscribe,
    series,
    chartAxis,
    sharedSec,
    hoverController,
  ]);

  const previewFromChart = useCallback(
    (next: number | null) => {
      if (!hoverEnabled) {
        setPreviewProgress(null);
        return;
      }
      setPreviewProgress(progressFromSeriesIndex(next));
    },
    [hoverEnabled, progressFromSeriesIndex],
  );
  const seekFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(null);
      setProgress(progressFromSeriesIndex(next));
    },
    [progressFromSeriesIndex],
  );
  const chartScrub = bindChartScrub(series.length, {
    onPreviewIndex: hoverEnabled ? previewFromChart : undefined,
    onSeekIndex: seekFromChart,
  });
  const onChartMouseMove = useCallback(
    (state: Parameters<typeof hoverIndex>[0]) => {
      const index = hoverIndex(state);
      if (isSeekPointer(state)) seekFromChart(index);
      else if (hoverEnabled) previewFromChart(index);
    },
    [hoverEnabled, previewFromChart, seekFromChart],
  );

  const showMap = ordered.some((item) => hasGps(item.lap.telemetry));
  const multiSession = filteredSessions.length > 1;
  const totalLaps = filteredSessions.reduce(
    (sum, session) => sum + session.laps.length,
    0,
  );

  function removeSlot(key: string) {
    if (slots.length <= 2) return;
    userTouchedSlotsRef.current = true;
    const index = slots.findIndex((slot) => slot.key === key);
    setSlots((prev) => prev.filter((slot) => slot.key !== key));
    if (index >= 0 && index === refIndex) setRefIndex(0);
    else if (index >= 0 && index < refIndex) setRefIndex((r) => r - 1);
  }

  /** Tap a lap in the browse list to add/remove it from the comparison set. */
  function toggleComparedLap(sessionId: string, lapId: string) {
    if (readOnly) return;
    userTouchedSlotsRef.current = true;
    const existing = slots.findIndex(
      (slot) => slot.sessionId === sessionId && slot.lapId === lapId,
    );
    if (existing >= 0) {
      removeSlot(slots[existing]!.key);
      return;
    }
    if (slots.length >= MAX_COMPARE_LAPS) return;
    setSlots((prev) => [
      ...prev,
      { key: newSlotKey(), sessionId, lapId },
    ]);
  }

  const browseSession =
    filteredSessions.find((session) => session.id === activeBrowseSessionId) ??
    filteredSessions[0] ??
    null;

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

  const lapPicker = (
    <div className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3">
      {trackOptions.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            Track
          </span>
          <select
            value={trackFilter}
            onChange={(event) => setTrackFilter(event.target.value)}
            className="apex-pressable min-h-10 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          >
            {trackOptions.map((trackId) => (
              <option key={trackId} value={trackId}>
                {getTrack(trackId)?.name ?? trackId}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Comparing ({slots.length}/{MAX_COMPARE_LAPS})
          {readOnly ? " · read-only" : ""}
        </p>
        {/* Fixed min-height so chip wrap on iPhone doesn't shift Play/controls. */}
        <div className="flex min-h-[2.75rem] flex-wrap content-start gap-1.5">
          {slots.map((slot, index) => {
            const session =
              filteredSessions.find((s) => s.id === slot.sessionId) ?? null;
            const lap = session?.laps.find((item) => item.id === slot.lapId);
            const color = COMPARE_COLORS[index % COMPARE_COLORS.length];
            const isRef = index === refIndex;
            return (
              <div
                key={slot.key}
                className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/80 px-2 py-1.5"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span className="font-mono text-xs text-zinc-100">
                  L{lap?.lap_number ?? "—"}{" "}
                  <span className="text-zinc-500">
                    {formatLapTime(lap?.lap_time_ms ?? 0)}
                  </span>
                </span>
                {isRef ? (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-orange-400">
                    Ref
                  </span>
                ) : null}
                {multiSession ? (
                  <span className="max-w-[9rem] truncate text-[10px] text-zinc-500">
                    {session
                      ? formatSessionPickerLabel(session)
                      : slot.sessionId}
                  </span>
                ) : null}
                {!readOnly ? (
                  <span className="ml-auto flex gap-0.5">
                    {!isRef ? (
                      <button
                        type="button"
                        onClick={() => {
                          userTouchedSlotsRef.current = true;
                          setRefIndex(index);
                        }}
                        className="apex-pressable apex-pressable--muted rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-orange-400"
                      >
                        Set ref
                      </button>
                    ) : null}
                    {slots.length > 2 ? (
                      <button
                        type="button"
                        onClick={() => removeSlot(slot.key)}
                        className="apex-pressable apex-pressable--muted rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-500"
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {!readOnly ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              Session
            </span>
            <select
              value={browseSession?.id ?? ""}
              onChange={(event) => setBrowseSessionId(event.target.value)}
              className="apex-pressable min-h-10 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
            >
              {filteredSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {formatSessionPickerLabel(session)}
                  {session.kind === "upload" ? " · you" : ""}
                  {session.kind === "friends" ? " · friends" : ""}
                  {session.kind === "public" ? " · public" : ""}
                  {session.kind === "demo" ? " · demo" : ""}
                </option>
              ))}
            </select>
          </label>

          <SessionLapToggleList
            session={browseSession}
            slots={slots}
            atCapacity={slots.length >= MAX_COMPARE_LAPS}
            onToggle={toggleComparedLap}
          />
        </>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-2">
      {lapPicker}

      {extraToolTabs?.length ? (
        <SessionToolsPanel
          tabs={extraToolTabs}
          defaultTab={extraToolTabs[0]?.id}
        />
      ) : null}

      {sameLap || ordered.length < 2 ? (
        <p className="text-sm text-zinc-500">
          Pick at least two different laps from the list above.
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
            <aside className="flex min-h-[300px] flex-col">
              {showMap ? (
                <TrackMap
                  traces={mapTraces}
                  activeProgress={progress}
                  progressBasis="time"
                  durationMs={sharedMs}
                  progressSubscribe={
                    playing && progressSubscribe
                      ? progressSubscribe
                      : undefined
                  }
                  previewProgress={hoverEnabled ? previewProgress : null}
                  onPreviewProgress={
                    hoverEnabled ? setPreviewProgress : undefined
                  }
                  hoverPreviewEnabled={hoverEnabled}
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
                  panel
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
                  onPlayingChange={setPlaying}
                  onProgressSubscribe={(subscribe) =>
                    setProgressSubscribe(() => subscribe)
                  }
                  compact
                />
              </div>
              <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  Telemetry · {chartAxis === "time" ? "time sync" : "distance"}
                </p>
                <div
                  className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-[11px]"
                  role="group"
                  aria-label="Chart axis"
                >
                  {(
                    [
                      { value: "time" as const, label: "Time" },
                      { value: "track" as const, label: "Distance" },
                    ] as const
                  ).map((option) => {
                    const active = chartAxis === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setChartAxis(option.value)}
                        className={`min-h-7 rounded-md px-2.5 font-medium transition ${
                          active
                            ? "bg-zinc-100 text-zinc-950"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <HoverCursorScope
                controller={hoverController}
                hoverEnabled={hoverEnabled}
                onPreviewIndex={hoverEnabled ? previewFromChart : undefined}
                className="flex flex-col gap-2"
              >

              {stackedChannels.includes("speed") ? (
                <ChartCard
                  title="Speed"
                  hint={
                    chartAxis === "time"
                      ? "Same elapsed ms · map shows gap"
                      : analysisMode === "snapped"
                        ? "Aligned on snapped track distance"
                        : "Aligned on raw GPS path"
                  }
                  scrub={chartScrub}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={speedSeries}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis
                        stroke="#71717a"
                        fontSize={11}
                        unit={` ${speedUnitLabel}`}
                        width={48}
                      />
                      <Tooltip
                        cursor={false}
                        content={<CompareTooltip mode="speed" speedUnit={speedUnit} axis={chartAxis} />}
                      />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                    chartAxis === "time"
                      ? "Meters ahead of ref at same elapsed time"
                      : analysisMode === "snapped"
                        ? "Snapped · positive means behind reference"
                        : "Raw · positive means behind reference"
                  }
                  scrub={chartScrub}
                >
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} unit=" s" width={48} />
                      <Tooltip cursor={false} content={<CompareTooltip mode="delta" axis={chartAxis} />} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip  cursor={false} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip  cursor={false} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={40} />
                      <Tooltip cursor={false} content={<CompareTooltip mode="g" axis={chartAxis} />} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip  cursor={false} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
                  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                    <LineChart
                      data={series}
                      syncId="compare"
                      margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                      onMouseMove={onChartMouseMove}
                      onMouseLeave={() => setPreviewProgress(null)}
                    >
                      <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                      <XAxis
                        dataKey={xKey}
                        type="number"
                        tickFormatter={formatXTick}
                        stroke="#71717a"
                        fontSize={11}
                      />
                      <YAxis stroke="#71717a" fontSize={11} width={48} />
                      <Tooltip  cursor={false} />
                      <Legend />
                      {hoverAt != null ? (
                        <ReferenceLine
                          x={chartAxis === "time" ? series[hoverAt]?.t : series[hoverAt]?.dist}
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
              </HoverCursorScope>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Always-visible lap list for one session. Tap to add/remove from compare.
 * No nested scroll pane — page scroll only.
 */
function SessionLapToggleList({
  session,
  slots,
  atCapacity,
  onToggle,
}: {
  session: CompareSessionOption | null;
  slots: SlotState[];
  atCapacity: boolean;
  onToggle: (sessionId: string, lapId: string) => void;
}) {
  const ordered = useMemo(() => {
    const laps = session?.laps ?? [];
    return [...laps].sort((a, b) => a.lap_number - b.lap_number);
  }, [session?.laps]);
  const fastest = bestLapTimeMs(ordered);
  const kinds = useMemo(() => lapKindsForSession(ordered), [ordered]);
  const selectedKeys = useMemo(
    () => new Set(slots.map((slot) => `${slot.sessionId}:${slot.lapId}`)),
    [slots],
  );

  if (!session) {
    return <p className="text-sm text-zinc-500">No session available.</p>;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
        Laps in session
      </p>
      <div
        role="listbox"
        aria-label="Laps in session"
        aria-multiselectable
        className="divide-y divide-zinc-800/80 rounded-lg border border-zinc-800/80"
      >
        {ordered.map((lap) => {
          const key = `${session.id}:${lap.id}`;
          const selected = selectedKeys.has(key);
          const excluded = isLapExcluded(lap);
          const isBest =
            !excluded && fastest != null && lap.lap_time_ms === fastest;
          const kind = kinds.get(lap.lap_number) ?? "hot";
          const kindLabel =
            kind === "out" ? "Out" : kind === "in" ? "In" : null;
          const blocked = !selected && atCapacity;
          return (
            <button
              key={lap.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={blocked}
              onClick={() => onToggle(session.id, lap.id)}
              className={`apex-pressable flex min-h-11 w-full items-center gap-2 px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                selected ? "apex-pressable--selected" : "apex-pressable--row"
              } ${excluded && !selected ? "opacity-55" : ""}`}
            >
              <span
                className={`w-8 shrink-0 font-mono text-xs ${
                  selected ? "text-black/70" : "text-zinc-500"
                }`}
              >
                L{lap.lap_number}
              </span>
              <span
                className={`min-w-0 flex-1 font-mono tracking-tight ${
                  selected
                    ? "text-black"
                    : isBest
                      ? "text-orange-400"
                      : "text-zinc-100"
                }`}
              >
                {formatLapTime(lap.lap_time_ms)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {isBest ? (
                  <span
                    className={`text-[10px] font-sans uppercase tracking-[0.16em] ${
                      selected ? "text-black/70" : "text-orange-500"
                    }`}
                  >
                    Best
                  </span>
                ) : null}
                {kindLabel ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-sans uppercase tracking-[0.14em] ${
                      selected
                        ? "bg-black/15 text-black/80"
                        : kind === "out"
                          ? "border border-sky-500/40 text-sky-300"
                          : "border border-rose-500/40 text-rose-300"
                    }`}
                  >
                    {kindLabel}
                  </span>
                ) : null}
                {excluded ? (
                  <span
                    className={`text-[10px] font-sans uppercase tracking-[0.12em] ${
                      selected ? "text-black/55" : "text-zinc-500"
                    }`}
                  >
                    Excl
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        {!ordered.length ? (
          <p className="px-2.5 py-3 text-sm text-zinc-500">No laps in session.</p>
        ) : null}
      </div>
      {atCapacity ? (
        <p className="text-[11px] text-zinc-500">
          Comparison full — remove a lap above to add another.
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500">
          Tap a lap to add or remove. Switch sessions to keep prior picks.
        </p>
      )}
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
  const plotRef = useRef<HTMLDivElement | null>(null);
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
        ref={plotRef}
        className="relative h-[200px] min-h-[200px] touch-none sm:h-[220px] sm:min-h-[220px]"
        data-apex-chart-plot="compare"
        style={{ minHeight: 200 }}
        {...scrub}
      >
        <div className="absolute inset-0 min-h-0">{children}</div>
        <HoverCursorLine plotRef={plotRef} />
        <PlaybackCursorLine plotRef={plotRef} />
      </div>
    </div>
  );
}

function CompareTooltip({
  active,
  payload,
  label,
  mode = "speed",
  speedUnit = "mph",
  axis = "time",
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: number;
  mode?: "speed" | "delta" | "g";
  /** When mode=speed, values are already converted to this unit. */
  speedUnit?: "mph" | "kmh";
  axis?: CompareAxis;
}) {
  if (!active || !payload?.length) return null;
  const unit = speedUnitSuffix(speedUnit);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100">
      <p className="mb-1 text-zinc-500">
        {axis === "time"
          ? formatClock(Number(label))
          : formatDistance(Number(label))}
      </p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}:{" "}
          {mode === "delta"
            ? axis === "time"
              ? `${Number(item.value) >= 0 ? "+" : ""}${Number(item.value).toFixed(1)} m`
              : formatGap(Number(item.value))
            : mode === "g"
              ? formatG(Number(item.value))
              : `${Number(item.value).toFixed(0)} ${unit}`}
        </p>
      ))}
    </div>
  );
}
