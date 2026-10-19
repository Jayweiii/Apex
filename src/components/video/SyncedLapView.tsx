"use client";

import { PlaybackControls } from "@/components/PlaybackControls";
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
import {
  formatGap,
  formatKmh,
  formatLapTime,
  formatMph,
} from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import {
  createSyncSuppress,
  DRIFT_CHECK_INTERVAL_MS,
  lapProgressFromVideoTime,
  nearestPlaybackSpeed,
  needsDriftCorrection,
  type PlayerSyncEvent,
  type SyncAuthority,
} from "@/lib/playback-sync";
import { sessionLapHref } from "@/lib/session-lap-url";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { isVideoSynced } from "@/lib/video-sync-guide";
import {
  toSyncLaps,
  videoTimeFromLapProgress,
  type SyncLap,
} from "@/lib/video-sync";
import { progressFromIndex } from "@/lib/scrub";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function MissingYouTube({ sessionId }: { sessionId?: string }) {
  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/80 px-4 text-center">
      <p className="text-sm text-zinc-300">
        No YouTube video for this lap.
      </p>
      <p className="text-xs text-zinc-500">
        Onboards are YouTube-only. Upload the clip to YouTube and paste the
        link on the session page, then sync offset here.
      </p>
      {sessionId ? (
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
  const chartData = useMemo(
    () => enrichTelemetry(analysisPoints(matched, lap.telemetry, analysisMode)),
    [matched, lap.telemetry, analysisMode],
  );
  const data = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(matched, lap.telemetry, centerline ? gpsMode : "raw"),
      ),
    [matched, lap.telemetry, gpsMode, centerline],
  );
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

  const handleVideoChange = useCallback(
    (next: SessionVideo) => {
      setDraftVideo(next);
      onVideoChange?.(next);
    },
    [onVideoChange],
  );

  const durationMs = Math.max(
    1,
    lap.lap_time_ms ||
      Math.round((chartData[chartData.length - 1]?.t ?? 1) * 1000),
  );

  const clock = usePlaybackClock({
    durationMs,
    enabled: true,
    rootRef,
  });

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
        authorityRef.current = "video";
        clock.play();
        return;
      }
      if (event.type === "pause" || event.type === "ended") {
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
    [activeVideo, locked, applyVideoTime, clock, player, videoTime],
  );

  const index =
    chartData.length < 2
      ? null
      : Math.round(clock.progress * (chartData.length - 1));
  const cursorPoint =
    index != null && chartData[Math.round(index)]
      ? chartData[Math.round(index)]
      : null;
  const deltaVsBest =
    bestLapMs != null ? (lap.lap_time_ms - bestLapMs) / 1000 : null;

  const setProgressFromUi = useCallback(
    (next: number | null) => {
      if (next == null) return;
      authorityRef.current = "clock";
      clock.pause();
      clock.setProgress(next);
      // Pin telemetry freely during setup; seek video only when Synced.
      if (locked) seekVideoToProgress(next, true);
    },
    [clock, locked, seekVideoToProgress],
  );

  const hoverFromChart = useCallback(
    (next: number | null) => {
      const nextProgress = progressFromIndex(next, chartData.length);
      if (nextProgress == null) return;
      setProgressFromUi(nextProgress);
    },
    [chartData.length, setProgressFromUi],
  );

  const chartLapTimeSec =
    clock.progress *
    (chartData[chartData.length - 1]?.t ?? lap.lap_time_ms / 1000);

  const mapProps = {
    centerline,
    gpsMode: centerline ? gpsMode : undefined,
    onGpsModeChange: centerline ? setGpsMode : undefined,
    analysisMode: centerline ? analysisMode : undefined,
    onAnalysisModeChange: centerline ? setAnalysisMode : undefined,
    analysisDisabled: !hasAnalysisSnap,
  } as const;

  const bindPlayer = useCallback((handle: VideoPlayerHandle | null) => {
    playerRef.current = handle;
    setPlayer((prev) => (prev === handle ? prev : handle));
  }, []);

  const onTogglePlay = useCallback(() => {
    authorityRef.current = "clock";
    clock.toggle();
  }, [clock]);

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
    if (clock.progress >= 1) clock.setProgress(0);
    clock.play();
    if (activeVideo) {
      const t = videoTimeFromLapProgress(
        currentSyncLap,
        clock.progress >= 1 ? 0 : clock.progress,
        activeVideo,
      );
      drivePlayer("seek", t);
      drivePlayer("play");
    }
  }, [clock, activeVideo, currentSyncLap, drivePlayer]);

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
    />
  );

  const mapBlock = hasGps(data) ? (
    <TrackMap
      traces={[
        {
          id: "lap",
          label: `Lap ${lap.lap_number}`,
          color: "#f97316",
          points: data,
          colorBySpeed: true,
        },
      ]}
      activeProgress={clock.progress}
      onProgress={setProgressFromUi}
      {...mapProps}
    />
  ) : (
    <MissingGps />
  );

  return (
    <div ref={rootRef} tabIndex={0} className="flex flex-col gap-6 outline-none">
      {activeVideo ? (
        <div className="space-y-4">
          <div className="w-full">
            {activeVideo.provider === "youtube" && activeVideo.youtubeId ? (
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
              <MissingYouTube sessionId={sessionId} />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <span className="font-mono text-zinc-200">
                {formatLapTime(lap.lap_time_ms)}
              </span>
              {cursorPoint ? (
                <span>
                  {formatMph(cursorPoint.speed)} · {formatKmh(cursorPoint.speed)}
                </span>
              ) : null}
              {deltaVsBest != null ? (
                <span>Δ best {formatGap(deltaVsBest)}</span>
              ) : null}
              {!locked ? (
                <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                  Sync setup · video free
                </span>
              ) : null}
            </div>
            {sessionId && siblingLaps.length > 1 ? (
              <div
                className="mt-3 flex flex-wrap items-center gap-1.5"
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
          <div>{mapBlock}</div>
        </div>
      ) : (
        <>
          {playbackBar}
          {mapBlock}
        </>
      )}

      {(activeVideo || canEditSync) && (onVideoChange || onAttachYouTube) ? (
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
            // Independent seek during setup; after sync still allow fine nudge.
            drivePlayer("seek", t);
            setVideoTime(t);
            if (locked) applyVideoTime(t);
          }}
          onAttachYouTube={onAttachYouTube}
          onPlayBoth={locked ? playBoth : undefined}
        />
      ) : null}

      <StackedLapTelemetry
        points={chartData}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
        trimMarkers={trimMarkers ?? undefined}
        onTrimBoundaryDrag={onTrimBoundaryDrag}
        fallback={null}
      />
    </div>
  );
}
