"use client";

import { createHoverCursorController } from "@/components/hover-cursor";
import { PlaybackControls } from "@/components/PlaybackControls";
import {
  SessionToolsPanel,
  type SessionToolTab,
} from "@/components/SessionToolsPanel";
import { StackedLapTelemetry } from "@/components/StackedTelemetry";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { usePlaybackClock } from "@/components/usePlaybackClock";
import { LapVideoSyncGuide } from "@/components/video/LapVideoSyncGuide";
import { Mp4Player } from "@/components/video/Mp4Player";
import { YouTubePlayer } from "@/components/video/YouTubePlayer";
import type { VideoPlayerHandle } from "@/components/video/useVideoSync";
import { useAnalysisMode } from "@/lib/analysis-mode";
import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import { hasGps } from "@/lib/compare";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import { formatGap, formatLapTime, formatSpeed } from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import {
  lapKindsForSession,
  resolveLapSfCrossing,
} from "@/lib/lap-sf-boundary";
import type { StartFinishLine } from "@/lib/start-finish-line";
import {
  createSyncSuppress,
  DRIFT_CHECK_INTERVAL_MS,
  lapProgressFromVideoTime,
  nearestPlaybackSpeed,
  needsDriftCorrection,
  type PlayerSyncEvent,
  type SyncAuthority,
} from "@/lib/playback-sync";
import {
  indexNearestTime,
  lapDurationSec,
  plotFractionFromTime,
  progressFromTimeSec,
  sampleAtTime,
  seriesT0,
  timeSecFromProgress,
} from "@/lib/playback-timebase";
import { sessionLapHref } from "@/lib/session-lap-url";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { isVideoSynced, syncBadgeForVideo } from "@/lib/video-sync-guide";
import {
  toSyncLaps,
  videoTimeFromLapProgress,
  type SyncLap,
} from "@/lib/video-sync";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

function MissingYouTube({
  sessionId,
  compact = false,
}: {
  sessionId?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex w-full max-w-full flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 text-center ${
        compact
          ? "h-[min(28vh,220px)] gap-1.5"
          : "aspect-video gap-3"
      }`}
    >
      <p className={`text-zinc-300 ${compact ? "text-xs" : "text-sm"}`}>
        No YouTube video for this lap.
      </p>
      {!compact ? (
        <p className="text-xs text-zinc-500">
          Onboards are YouTube-only. Upload the clip to YouTube and paste the
          link on the session page, then sync offset here.
        </p>
      ) : (
        <p className="text-[11px] text-zinc-500">
          Paste a YouTube link under Video sync
        </p>
      )}
      {sessionId && !compact ? (
        <a
          href={`/sessions/${sessionId}`}
          className="text-xs uppercase tracking-[0.16em] text-orange-400"
        >
          Open session to attach YouTube
        </a>
      ) : null}
    </div>
  );
}

export function SyncedLapView({
  sessionId,
  lap,
  siblingLaps,
  video,
  mp4Src,
  sessionStartedAtMs,
  bestLapMs,
  onVideoChange,
  trackId,
  trimMarkers,
  onTrimBoundaryDrag,
  onAttachYouTube,
  canEditSync = false,
  layout = "stack",
  sidebar,
  extraToolTabs,
  chartOverride,
  toolsOpenRequest,
  /**
   * When false, session page uses contextual controls (video/map/chart headers)
   * instead of a grouped tools toolbar — no duplicate Trim/Sync/Exclude.
   */
  toolsShowButtons = true,
  /** Contextual controls above the map (e.g. Edit start/finish). */
  mapHeader = null,
  /** Contextual controls above the speed chart (e.g. Trim + Save). */
  chartHeader = null,
  /** Open sync panel by default when video is unsynced. */
  defaultSyncOpen,
  sfLine = null,
  sfEditing = false,
  onSfEndpointMove,
}: {
  sessionId?: string;
  lap: {
    id: string;
    lap_number: number;
    lap_time_ms: number;
    start_offset_sec?: number;
    telemetry: TelemetryPoint[];
  };
  siblingLaps: Array<{
    id: string;
    lap_number: number;
    lap_time_ms: number;
    start_offset_sec?: number;
    telemetry: TelemetryPoint[];
  }>;
  video?: SessionVideo | null;
  /** @deprecated Local MP4 playback removed — YouTube-only. */
  mp4Src?: string | null;
  sessionStartedAtMs?: number;
  bestLapMs?: number;
  onVideoChange?: (next: SessionVideo) => void;
  trackId?: string | null;
  /** Optional trim markers on the speed chart (lap-local seconds). */
  trimMarkers?: { startT: number; endT: number } | null;
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  /** Paste a YouTube URL for this lap from the point-match stepper. */
  onAttachYouTube?: (input: {
    youtubeId: string;
    youtubeUrl: string;
    title: string;
  }) => void | Promise<void>;
  canEditSync?: boolean;
  /**
   * `workspace` = one-screen dashboard (map+laps left, video+telemetry right).
   * `stack` = classic vertical layout (mobile / embeds).
   */
  layout?: "stack" | "workspace";
  /** Lap list (or other) under the map in workspace layout. */
  sidebar?: ReactNode;
  /** Secondary panels for compare / legacy tools drawer. */
  extraToolTabs?: SessionToolTab[];
  /**
   * When trimming, chart uses padded session context (grey neighbors) while
   * map/playback keep the effective trimmed lap.
   */
  chartOverride?: {
    points: TelemetryPoint[];
    trimMarkers?: { startT: number; endT: number };
  } | null;
  /** Legacy toolbar requests opening a tools tab (compare / LocalGarage). */
  toolsOpenRequest?: { tab: string; nonce: number } | null;
  /** When false, contextual headers own Sync/Trim (no SessionToolsPanel buttons). */
  toolsShowButtons?: boolean;
  mapHeader?: ReactNode;
  chartHeader?: ReactNode;
  defaultSyncOpen?: boolean;
  sfLine?: StartFinishLine | null;
  sfEditing?: boolean;
  onSfEndpointMove?: (which: "a" | "b", lat: number, lon: number) => void;
}) {
  const centerline = useMemo(
    () =>
      resolveTrackCenterline(trackId, null, [
        lap.telemetry,
        ...siblingLaps.map((item) => item.telemetry),
      ]),
    [trackId, lap.telemetry, siblingLaps],
  );
  const matched = useMemo(
    () => mapMatchLap(lap.telemetry, centerline),
    [lap.telemetry, centerline],
  );
  const [gpsMode, setGpsMode] = useState<GpsDisplayMode>("snapped");
  const {
    mode: analysisMode,
    setMode: setAnalysisMode,
    hasSnap: hasAnalysisSnap,
  } = useAnalysisMode(Boolean(centerline));
  const chartData = useMemo(() => {
    if (chartOverride?.points?.length) {
      return enrichTelemetry(chartOverride.points);
    }
    return enrichTelemetry(
      analysisPoints(matched, lap.telemetry, analysisMode),
    );
  }, [chartOverride, matched, lap.telemetry, analysisMode]);

  const effectiveTrimMarkers =
    chartOverride?.trimMarkers ?? trimMarkers ?? undefined;
  const data = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(matched, lap.telemetry, centerline ? gpsMode : "raw"),
      ),
    [matched, lap.telemetry, gpsMode, centerline],
  );
  const mapLapMeta = useMemo(() => {
    const qualityInputs = [
      {
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        telemetry: lap.telemetry,
      },
      ...siblingLaps
        .filter((s) => s.id !== lap.id)
        .map((s) => ({
          id: s.id,
          lap_number: s.lap_number,
          lap_time_ms: s.lap_time_ms,
          telemetry: s.telemetry,
        })),
    ];
    const kinds = lapKindsForSession(qualityInputs);
    const kind = kinds.get(lap.lap_number) ?? "hot";
    return {
      lapKind: kind,
      sfCrossing: resolveLapSfCrossing(data, kind, sfLine),
    };
  }, [lap, siblingLaps, data, sfLine]);
  const syncLaps = useMemo(
    () =>
      toSyncLaps(
        siblingLaps.map((item) => ({
          id: item.id,
          lap_number: item.lap_number,
          lap_time_ms: item.lap_time_ms,
          start_offset_sec: item.start_offset_sec,
          telemetry: item.telemetry,
        })),
      ),
    [siblingLaps],
  );
  const currentSyncLap: SyncLap = useMemo(() => {
    const found = syncLaps.find((item) => item.id === lap.id);
    if (found) return found;
    return {
      id: lap.id,
      lapNumber: lap.lap_number,
      lapTimeMs: lap.lap_time_ms,
      startOffsetSec: lap.start_offset_sec ?? 0,
      points: lap.telemetry,
    };
  }, [syncLaps, lap]);

  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [player, setPlayer] = useState<VideoPlayerHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [videoTime, setVideoTime] = useState(0);
  const [draftVideo, setDraftVideo] = useState<SessionVideo | null>(
    video ?? null,
  );
  const authorityRef = useRef<SyncAuthority>("clock");
  const suppress = useRef(createSyncSuppress());
  /** Mirrors `clock.playing` for player-event handlers (avoid stale closures). */
  const playingRef = useRef(false);
  useEffect(() => {
    setDraftVideo(video ?? null);
  }, [video]);

  const activeVideo: SessionVideo | null =
    draftVideo ??
    video ??
    (mp4Src
      ? {
          id: "legacy-mp4",
          provider: "mp4",
          offsetSec: 0,
          rate: 1,
          syncSource: "unsynced",
        }
      : null);

  /** Two-way lock only after a saved sync (point-match / auto / tod). */
  void sessionStartedAtMs;
  const locked = isVideoSynced(activeVideo);
  const [syncOpen, setSyncOpen] = useState(
    () =>
      defaultSyncOpen ??
      Boolean(canEditSync && (!activeVideo || !isVideoSynced(activeVideo))),
  );

  useEffect(() => {
    if (toolsOpenRequest?.tab === "sync") setSyncOpen(true);
  }, [toolsOpenRequest?.nonce, toolsOpenRequest?.tab]);

  const handleVideoChange = useCallback(
    (next: SessionVideo) => {
      setDraftVideo(next);
      onVideoChange?.(next);
    },
    [onVideoChange],
  );

  // Shared time base: progress 0..1 ≡ ms from interpolated lap start /
  // lap_time_ms. Map, charts, and video all sample on this clock.
  const durationMs = Math.max(1, lap.lap_time_ms || 1);
  const durationSec = lapDurationSec(durationMs);

  const clock = usePlaybackClock({
    durationMs,
    enabled: true,
    rootRef,
  });
  playingRef.current = clock.playing;

  const hoverController = useMemo(() => createHoverCursorController(), []);
  useEffect(() => () => hoverController.dispose(), [hoverController]);

  const drivePlayer = useCallback(
    (action: "play" | "pause" | "seek" | "rate", value?: number) => {
      if (!player) return;
      suppress.current.arm();
      if (action === "play") player.play();
      else if (action === "pause") player.pause();
      else if (action === "seek" && value != null) {
        player.seek(value);
        setVideoTime(value);
      } else if (action === "rate" && value != null) {
        player.setRate?.(value);
      }
    },
    [player],
  );

  const seekVideoToProgress = useCallback(
    (nextProgress: number, force = false) => {
      if (!activeVideo || !player) return;
      const t = videoTimeFromLapProgress(
        currentSyncLap,
        nextProgress,
        activeVideo,
      );
      const actual = player.getTime();
      if (force || needsDriftCorrection(t, actual)) {
        drivePlayer("seek", t);
      } else {
        setVideoTime(actual);
      }
    },
    [activeVideo, player, currentSyncLap, drivePlayer],
  );

  // Clock → video only after Synced (setup keeps YouTube independent).
  useEffect(() => {
    if (!locked || !activeVideo || !player) return;
    if (authorityRef.current !== "clock") return;
    drivePlayer(clock.playing ? "play" : "pause");
    drivePlayer("rate", clock.speed);
  }, [locked, activeVideo, player, clock.playing, clock.speed, drivePlayer]);

  useEffect(() => {
    if (!locked || !activeVideo || !player) return;
    if (authorityRef.current !== "clock") return;
    if (clock.playing) return;
    seekVideoToProgress(clock.progress, true);
  }, [
    locked,
    activeVideo,
    player,
    clock.playing,
    clock.progress,
    seekVideoToProgress,
  ]);

  useEffect(() => {
    if (!locked || !activeVideo || !player || !clock.playing) return;
    const id = window.setInterval(() => {
      if (authorityRef.current !== "clock") return;
      seekVideoToProgress(clock.progress, false);
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [locked, activeVideo, player, clock.playing, clock.progress, seekVideoToProgress]);

  // During setup, poll video clock so Sync here sees the paused frame.
  useEffect(() => {
    if (locked || !player) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 100) return;
      last = now;
      setVideoTime(player.getTime());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [locked, player]);

  const applyVideoTime = useCallback(
    (time: number) => {
      if (!activeVideo) return;
      const next = lapProgressFromVideoTime(
        currentSyncLap,
        time,
        activeVideo,
      );
      clock.setProgress(next);
      setVideoTime(time);
    },
    [activeVideo, currentSyncLap, clock],
  );

  const onPlayerEvent = useCallback(
    (event: PlayerSyncEvent) => {
      if (!activeVideo) return;
      if (suppress.current.active()) return;
      // Before Synced: track video time only — do not drive the track clock.
      if (!locked) {
        if (event.type === "time" || event.type === "seek" || event.type === "pause") {
          const t =
            event.type === "seek"
              ? event.time
              : (player?.getTime() ?? videoTime);
          setVideoTime(t);
        }
        return;
      }

      if (event.type === "play") {
        // Clock owns play/pause from PlaybackControls — ignore player play
        // echoes (buffering resume) so the wall-clock RAF keeps advancing.
        if (authorityRef.current === "clock" && playingRef.current) return;
        authorityRef.current = "video";
        const t = player?.getTime() ?? videoTime;
        const lapStartVideo = videoTimeFromLapProgress(
          currentSyncLap,
          0,
          activeVideo,
        );
        // Video scrubbed/paused before the lap's synced start: jump to lap
        // start so progress isn't stuck at 0 while the video plays intro.
        if (t < lapStartVideo - 0.2) {
          authorityRef.current = "clock";
          drivePlayer("seek", lapStartVideo);
          clock.setProgress(0);
          clock.play();
          return;
        }
        clock.play();
        applyVideoTime(t);
        return;
      }
      if (event.type === "pause" || event.type === "ended") {
        // Ignore pause echoes while the shared clock is driving playback.
        if (
          event.type === "pause" &&
          authorityRef.current === "clock" &&
          playingRef.current
        ) {
          return;
        }
        authorityRef.current = "video";
        clock.pause();
        if (event.type === "ended") {
          clock.setProgress(1);
        } else {
          applyVideoTime(player?.getTime() ?? videoTime);
        }
        return;
      }
      if (event.type === "seek") {
        authorityRef.current = "video";
        clock.pause();
        applyVideoTime(event.time);
        return;
      }
      if (event.type === "rate") {
        authorityRef.current = "video";
        clock.setSpeed(nearestPlaybackSpeed(event.rate));
        return;
      }
      if (event.type === "time") {
        if (authorityRef.current !== "video") return;
        applyVideoTime(event.time);
      }
    },
    [
      activeVideo,
      locked,
      applyVideoTime,
      clock,
      player,
      videoTime,
      currentSyncLap,
      drivePlayer,
    ],
  );

  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const hoverReadoutRef = useRef<HTMLSpanElement | null>(null);
  const hoverEnabled = !clock.playing;

  // While playing, drop any lingering hover preview so readouts/markers
  // follow the playback clock only.
  useEffect(() => {
    if (hoverEnabled) return;
    setPreviewProgress(null);
    hoverController.leave();
  }, [hoverEnabled, hoverController]);

  /** Map leave/clear must also drop chart hover line + readout. */
  const setMapPreviewProgress = useCallback(
    (next: number | null) => {
      setPreviewProgress(next);
      if (next == null) hoverController.leave();
    },
    [hoverController],
  );

  /** Playback window in chart time (trim window or full lap). */
  const playbackWindow = useMemo(() => {
    if (effectiveTrimMarkers) {
      return {
        t0: effectiveTrimMarkers.startT,
        durationSec: Math.max(
          0.001,
          effectiveTrimMarkers.endT - effectiveTrimMarkers.startT,
        ),
      };
    }
    // Prefer t0=0 (interpolated lap start) when series starts near 0;
    // otherwise use the first sample so padded neighbors still map cleanly.
    const first = seriesT0(chartData);
    const t0 = Math.abs(first) < 0.05 ? 0 : first;
    return { t0, durationSec };
  }, [effectiveTrimMarkers, chartData, durationSec]);

  const chartDomain = useMemo(() => {
    if (chartData.length < 2) return { firstT: 0, lastT: 1 };
    return {
      firstT: chartData[0]!.t,
      lastT: chartData[chartData.length - 1]!.t,
    };
  }, [chartData]);

  /** Map shared progress 0..1 → chart index via lap-local time. */
  const indexFromLapProgress = useCallback(
    (progress: number) => {
      if (chartData.length < 2) return null;
      const targetT = timeSecFromProgress(
        progress,
        playbackWindow.durationSec,
        playbackWindow.t0,
      );
      return indexNearestTime(chartData, targetT);
    },
    [chartData, playbackWindow],
  );

  const lapProgressFromChartIndex = useCallback(
    (next: number | null) => {
      if (next == null || chartData.length < 2) return null;
      const point = chartData[Math.min(chartData.length - 1, Math.max(0, next))];
      if (!point) return null;
      return progressFromTimeSec(
        point.t,
        playbackWindow.durationSec,
        playbackWindow.t0,
      );
    },
    [chartData, playbackWindow],
  );

  // Throttled React index for readout / pause scrub only — solid cursor
  // paints via hoverController.setPlaybackFraction every clock frame.
  const playbackIndex = indexFromLapProgress(clock.progress);

  const syncProbeRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const { firstT, lastT } = chartDomain;
    return clock.subscribe((progress) => {
      const targetT = timeSecFromProgress(
        progress,
        playbackWindow.durationSec,
        playbackWindow.t0,
      );
      const fraction = plotFractionFromTime(targetT, firstT, lastT);
      hoverController.setPlaybackFraction(fraction);
      hoverController.setPlaybackIndex(indexNearestTime(chartData, targetT));

      // Map samples the same shared time base (progressBasis="time").
      const mapPoint = data.length ? sampleAtTime(data, targetT) : null;
      const probe = syncProbeRef.current;
      if (probe) {
        probe.dataset.apexPlaybackT = String(targetT);
        probe.dataset.apexChartT = String(targetT);
        probe.dataset.apexMapT = String(mapPoint?.t ?? targetT);
        probe.dataset.apexMapLat = mapPoint?.lat != null ? String(mapPoint.lat) : "";
        probe.dataset.apexMapLon = mapPoint?.lon != null ? String(mapPoint.lon) : "";
        probe.dataset.apexProgress = String(progress);
      }
    });
  }, [
    clock,
    chartData,
    chartDomain,
    playbackWindow,
    hoverController,
    data,
  ]);
  const [speedUnit] = useSpeedUnit();
  const formatCursorReadout = useCallback(
    (index: number | null) => {
      if (index == null) return "";
      const point = chartData[index];
      if (!point) return "";
      return formatSpeed(point.speed, speedUnit);
    },
    [chartData, speedUnit],
  );
  const deltaVsBest =
    bestLapMs != null ? (lap.lap_time_ms - bestLapMs) / 1000 : null;

  const setProgressFromUi = useCallback(
    (next: number | null) => {
      if (next == null) return;
      setPreviewProgress(null);
      authorityRef.current = "clock";
      clock.pause();
      clock.setProgress(next);
      // Pin telemetry freely during setup; seek video only when Synced.
      if (locked) seekVideoToProgress(next, true);
    },
    [clock, locked, seekVideoToProgress],
  );

  const previewFromChart = useCallback(
    (next: number | null) => {
      if (!hoverEnabled) {
        setPreviewProgress(null);
        return;
      }
      setPreviewProgress(lapProgressFromChartIndex(next));
    },
    [hoverEnabled, lapProgressFromChartIndex],
  );

  const seekFromChart = useCallback(
    (next: number | null) => {
      const nextProgress = lapProgressFromChartIndex(next);
      if (nextProgress == null) return;
      setProgressFromUi(nextProgress);
    },
    [lapProgressFromChartIndex, setProgressFromUi],
  );

  const chartLapTimeSec = timeSecFromProgress(
    clock.progress,
    durationSec,
    0,
  );

  const mapProps = {
    centerline,
    gpsMode: centerline ? gpsMode : undefined,
    onGpsModeChange: centerline ? setGpsMode : undefined,
    analysisMode: centerline ? analysisMode : undefined,
    onAnalysisModeChange: centerline ? setAnalysisMode : undefined,
    analysisDisabled: !hasAnalysisSnap,
    sfLine: sfLine ?? undefined,
    sfEditing,
    onSfEndpointMove,
  } as const;

  const bindPlayer = useCallback((handle: VideoPlayerHandle | null) => {
    playerRef.current = handle;
    setPlayer((prev) => (prev === handle ? prev : handle));
  }, []);

  const onTogglePlay = useCallback(() => {
    authorityRef.current = "clock";
    if (clock.playing) {
      clock.pause();
      return;
    }
    const nextProgress = clock.progress >= 1 ? 0 : clock.progress;
    if (clock.progress >= 1) clock.setProgress(0);
    // Seek video to the lap-synced frame for this progress so Play never
    // leaves the clock stuck at 0 while YouTube plays pre-lap content.
    if (locked && activeVideo) {
      const t = videoTimeFromLapProgress(
        currentSyncLap,
        nextProgress,
        activeVideo,
      );
      const actual = player?.getTime();
      if (
        actual == null ||
        actual < t - 0.15 ||
        needsDriftCorrection(t, actual)
      ) {
        drivePlayer("seek", t);
      }
      drivePlayer("play");
    }
    clock.play();
  }, [
    clock,
    locked,
    activeVideo,
    currentSyncLap,
    player,
    drivePlayer,
  ]);

  const onSpeed = useCallback(
    (next: Parameters<typeof clock.setSpeed>[0]) => {
      authorityRef.current = "clock";
      clock.setSpeed(next);
      drivePlayer("rate", next);
    },
    [clock, drivePlayer],
  );

  const playBoth = useCallback(() => {
    authorityRef.current = "clock";
    const nextProgress = clock.progress >= 1 ? 0 : clock.progress;
    if (clock.progress >= 1) clock.setProgress(0);
    clock.play();
    if (activeVideo) {
      const t = videoTimeFromLapProgress(
        currentSyncLap,
        nextProgress,
        activeVideo,
      );
      drivePlayer("seek", t);
      drivePlayer("play");
    }
  }, [clock, activeVideo, currentSyncLap, drivePlayer]);

  const workspace = layout === "workspace";

  const playbackBar = (
    <PlaybackControls
      progress={clock.progress}
      onProgress={(next) => setProgressFromUi(next)}
      playing={clock.playing}
      onTogglePlay={onTogglePlay}
      speed={clock.speed}
      onSpeed={onSpeed}
      durationMs={durationMs}
      label="Lap playback"
      compact={workspace}
      sticky={workspace}
    />
  );

  // Stable traces identity — inline arrays recreated every clock.progress
  // tick would clearLayers/rebuild the route polyline (visible flicker).
  const mapTraces = useMemo(
    () => [
      {
        id: "lap",
        label: `Lap ${lap.lap_number}`,
        color: "#f97316",
        points: data,
        colorBySpeed: true as const,
        lapKind: mapLapMeta.lapKind,
        sfCrossing: mapLapMeta.sfCrossing,
      },
    ],
    [lap.lap_number, data, mapLapMeta.lapKind, mapLapMeta.sfCrossing],
  );

  const mapBlock = hasGps(data) ? (
    <TrackMap
      traces={mapTraces}
      activeProgress={clock.playing ? undefined : clock.progress}
      progressBasis="time"
      durationMs={durationMs}
      progressSubscribe={clock.playing ? clock.subscribe : undefined}
      previewProgress={hoverEnabled ? previewProgress : null}
      onPreviewProgress={hoverEnabled ? setMapPreviewProgress : undefined}
      hoverPreviewEnabled={hoverEnabled}
      onProgress={setProgressFromUi}
      compact={workspace}
      panel={workspace}
      defaultFollowId="lap"
      {...mapProps}
    />
  ) : (
    <div className={workspace ? "flex h-full items-center" : undefined}>
      <MissingGps />
    </div>
  );

  const videoBlock =
    activeVideo?.provider === "youtube" && activeVideo.youtubeId ? (
      <YouTubePlayer
        key={activeVideo.youtubeId}
        videoId={activeVideo.youtubeId}
        ref={bindPlayer}
        className="w-full"
        onPlayerEvent={onPlayerEvent}
      />
    ) : mp4Src ? (
      <Mp4Player
        src={mp4Src}
        ref={bindPlayer}
        className="w-full"
        onPlayerEvent={onPlayerEvent}
      />
    ) : (
      <MissingYouTube sessionId={sessionId} compact={workspace} />
    );

  const metaRow = (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-400 ${
        workspace ? "mt-1.5 text-xs" : "mt-3 text-sm"
      }`}
    >
      <span className="font-mono text-zinc-200">
        {formatLapTime(lap.lap_time_ms)}
      </span>
      <span
        ref={hoverReadoutRef}
        data-apex-hover-readout="1"
        className="font-mono"
      />
      <span
        ref={syncProbeRef}
        data-apex-playback-sync="1"
        hidden
        aria-hidden
      />
      {deltaVsBest != null ? (
        <span>Δ best {formatGap(deltaVsBest)}</span>
      ) : null}
      {!locked && activeVideo ? (
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-zinc-400">
          Sync setup · video free
        </span>
      ) : null}
    </div>
  );

  const syncPanel =
    (activeVideo || canEditSync) && (onVideoChange || onAttachYouTube) ? (
      <LapVideoSyncGuide
        video={activeVideo}
        videoTime={videoTime}
        lapStartOffsetSec={currentSyncLap.startOffsetSec}
        lapTimeMs={lap.lap_time_ms}
        lapNumber={lap.lap_number}
        chartLapTimeSec={chartLapTimeSec}
        canEdit={canEditSync || Boolean(onVideoChange)}
        sessionLevel={Boolean(activeVideo && !activeVideo.lapId)}
        availableLaps={siblingLaps.map((item) => ({
          lap_number: item.lap_number,
          lap_time_ms: item.lap_time_ms,
        }))}
        startsAtLapNumber={lap.lap_number}
        onStartsAtLapChange={
          sessionId
            ? (lapNumber) => {
                const target = siblingLaps.find(
                  (item) => item.lap_number === lapNumber,
                );
                if (!target || target.id === lap.id) return;
                window.location.assign(
                  sessionLapHref(sessionId, target, {
                    videoId: activeVideo?.id,
                  }),
                );
              }
            : undefined
        }
        onChange={onVideoChange ? handleVideoChange : undefined}
        onSeek={(t) => {
          drivePlayer("seek", t);
          setVideoTime(t);
          if (locked) applyVideoTime(t);
        }}
        onAttachYouTube={onAttachYouTube}
        onPlayBoth={locked ? playBoth : undefined}
      />
    ) : null;

  const telemetry = (
    <StackedLapTelemetry
      points={chartData}
      activeIndex={clock.playing ? null : playbackIndex}
      onPreviewIndex={previewFromChart}
      onSeekIndex={seekFromChart}
      syncId="lap-detail"
      trimMarkers={effectiveTrimMarkers}
      onTrimBoundaryDrag={onTrimBoundaryDrag}
      fallback={null}
      className={workspace ? "h-full" : undefined}
      hoverReadoutRef={hoverReadoutRef}
      formatHoverReadout={(i) => formatCursorReadout(i)}
      formatPlaybackReadout={formatCursorReadout}
      hoverEnabled={hoverEnabled}
      hoverController={hoverController}
    />
  );

  const contextual = !toolsShowButtons;
  const toolTabs: SessionToolTab[] = [];
  if (!contextual && syncPanel) {
    toolTabs.push({
      id: "sync",
      label: "Video sync",
      content: syncPanel,
      badge: activeVideo && !locked ? "!" : null,
    });
  }
  for (const tab of extraToolTabs ?? []) toolTabs.push(tab);

  const syncOffsetMeta = (() => {
    if (!activeVideo) return null;
    if (!locked) {
      return { text: syncBadgeForVideo(activeVideo).label, warn: true };
    }
    const sign = activeVideo.offsetSec >= 0 ? "+" : "";
    return {
      text: `offset ${sign}${activeVideo.offsetSec.toFixed(2)}s`,
      warn: false,
    };
  })();

  const videoHeader = contextual ? (
    <div
      className="mb-1.5 flex flex-wrap items-center justify-between gap-2"
      data-testid="video-tools-header"
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        Video
      </p>
      {syncPanel ? (
        <button
          type="button"
          data-testid="toolbar-sync"
          className="apex-disclosure"
          aria-expanded={syncOpen}
          aria-controls="video-sync-panel"
          onClick={() => setSyncOpen((open) => !open)}
        >
          <span className="apex-disclosure__label">Video sync</span>
          {!syncOpen && syncOffsetMeta ? (
            <span
              className={`apex-disclosure__meta${
                syncOffsetMeta.warn ? " apex-disclosure__meta--warn" : ""
              }`}
            >
              {syncOffsetMeta.text}
            </span>
          ) : null}
          <span className="apex-disclosure__chevron" aria-hidden>
            ▾
          </span>
        </button>
      ) : null}
    </div>
  ) : null;

  const videoSection = (
    <div>
      {videoHeader}
      {videoBlock}
      {contextual && syncOpen && syncPanel ? (
        <div
          id="video-sync-panel"
          role="region"
          aria-label="Video sync"
          className="mt-2 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3"
          data-testid="video-sync-panel"
        >
          {syncPanel}
        </div>
      ) : null}
      {metaRow}
    </div>
  );

  const mapSection = (
    <div className="flex min-h-[300px] flex-col gap-1.5">
      {mapHeader ? (
        <div className="shrink-0" data-testid="map-tools-header">
          {mapHeader}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{mapBlock}</div>
    </div>
  );

  const chartSection = (
    <div className="flex flex-col gap-1.5">
      {chartHeader ? (
        <div data-testid="chart-tools-header">{chartHeader}</div>
      ) : null}
      {telemetry}
    </div>
  );

  if (workspace) {
    return (
      <div ref={rootRef} tabIndex={0} className="flex flex-col gap-3 outline-none">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,0.85fr)_minmax(0,1.35fr)] lg:items-start lg:gap-3">
          <aside className="flex flex-col gap-2">
            {mapSection}
            {sidebar ? (
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40">
                {sidebar}
              </div>
            ) : null}
          </aside>

          <section className="flex flex-col gap-2">
            {videoSection}
            <div>{playbackBar}</div>
            {chartSection}
          </section>
        </div>

        {!contextual && toolTabs.length ? (
          <SessionToolsPanel
            tabs={toolTabs}
            defaultTab="sync"
            openRequest={toolsOpenRequest}
            showButtons={toolsShowButtons}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} tabIndex={0} className="flex flex-col gap-4 outline-none">
      <div className="space-y-3">
        <div className="w-full">
          {videoSection}
          {sessionId && siblingLaps.length > 1 ? (
            <div
              className="mt-2 flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Lap"
            >
              <span className="mr-1 text-[11px] uppercase tracking-[0.14em] text-zinc-500">
                Lap
              </span>
              {[...siblingLaps]
                .sort((a, b) => a.lap_number - b.lap_number)
                .map((item) => {
                  const selected = item.id === lap.id;
                  return (
                    <a
                      key={item.id}
                      href={sessionLapHref(sessionId, item, {
                        videoId: activeVideo?.id,
                      })}
                      aria-current={selected ? "true" : undefined}
                      className={`inline-flex min-h-8 items-center rounded-md px-2.5 font-mono text-xs ${
                        selected
                          ? "bg-orange-500 text-black"
                          : "border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                      }`}
                    >
                      {item.lap_number}
                    </a>
                  );
                })}
            </div>
          ) : null}
        </div>
        {playbackBar}
        {mapSection}
      </div>

      {!contextual && toolTabs.length ? (
        <SessionToolsPanel
          tabs={toolTabs}
          defaultTab="sync"
          openRequest={toolsOpenRequest}
          showButtons={toolsShowButtons}
        />
      ) : null}

      {chartSection}
    </div>
  );
}
