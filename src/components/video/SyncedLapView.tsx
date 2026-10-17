"use client";

import { GChart } from "@/components/GChart";
import { SpeedChart } from "@/components/SpeedChart";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { Mp4Player } from "@/components/video/Mp4Player";
import { SyncPanel } from "@/components/video/SyncPanel";
import { YouTubePlayer } from "@/components/video/YouTubePlayer";
import {
  useVideoSync,
  type VideoPlayerHandle,
} from "@/components/video/useVideoSync";
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
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import {
  cursorFromVideoTime,
  toSyncLaps,
  videoTimeFromLapProgress,
  type SyncLap,
} from "@/lib/video-sync";
import { progressFromIndex } from "@/lib/scrub";
import { useCallback, useMemo, useRef, useState } from "react";

export function SyncedLapView({
  lap,
  siblingLaps,
  video,
  mp4Src,
  sessionStartedAtMs,
  bestLapMs,
  followCharts = true,
  onVideoChange,
  trackId,
}: {
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
  mp4Src?: string | null;
  sessionStartedAtMs?: number;
  bestLapMs?: number;
  followCharts?: boolean;
  onVideoChange?: (next: SessionVideo) => void;
  trackId?: string | null;
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
  const [videoTime, setVideoTime] = useState(0);
  const [progress, setProgress] = useState<number | null>(null);
  const [follow, setFollow] = useState(followCharts);

  const activeVideo: SessionVideo | null =
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

  const { seek } = useVideoSync({
    player,
    onTime: (t) => {
      setVideoTime(t);
      if (!activeVideo) return;
      const cursor = cursorFromVideoTime(t, activeVideo, syncLaps);
      if (cursor.lap?.id === lap.id && data.length > 1) {
        const lastT = data[data.length - 1].t || 1;
        setProgress(Math.max(0, Math.min(1, cursor.lapTime / lastT)));
      }
    },
    enabled: Boolean(activeVideo),
  });

  const index =
    progress == null || chartData.length < 2
      ? null
      : Math.round(progress * (chartData.length - 1));
  const cursorPoint =
    index != null && chartData[Math.round(index)]
      ? chartData[Math.round(index)]
      : null;
  const deltaVsBest =
    bestLapMs != null ? (lap.lap_time_ms - bestLapMs) / 1000 : null;

  const hoverFromChart = useCallback(
    (next: number | null) => {
      const nextProgress = progressFromIndex(next, chartData.length);
      setProgress(nextProgress);
      if (nextProgress == null || !activeVideo) return;
      const paused = player?.isPaused() ?? true;
      if (follow || paused) {
        const t = videoTimeFromLapProgress(
          currentSyncLap,
          nextProgress,
          activeVideo,
        );
        seek(t);
        setVideoTime(t);
      }
    },
    [
      chartData.length,
      activeVideo,
      player,
      follow,
      currentSyncLap,
      seek,
    ],
  );

  const onMapProgress = useCallback(
    (next: number | null) => {
      setProgress(next);
      if (next == null || !activeVideo) return;
      const paused = player?.isPaused() ?? true;
      if (follow || paused) {
        const t = videoTimeFromLapProgress(currentSyncLap, next, activeVideo);
        seek(t);
        setVideoTime(t);
      }
    },
    [activeVideo, player, follow, currentSyncLap, seek],
  );

  const mapProps = {
    centerline,
    gpsMode: centerline ? gpsMode : undefined,
    onGpsModeChange: centerline ? setGpsMode : undefined,
    analysisMode: centerline ? analysisMode : undefined,
    onAnalysisModeChange: centerline ? setAnalysisMode : undefined,
    analysisDisabled: !hasAnalysisSnap,
  } as const;

  function bindPlayer(handle: VideoPlayerHandle | null) {
    playerRef.current = handle;
    setPlayer(handle);
  }

  return (
    <div className="flex flex-col gap-6">
      {activeVideo ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-3">
            {activeVideo.provider === "youtube" && activeVideo.youtubeId ? (
              <YouTubePlayer
                key={activeVideo.youtubeId}
                videoId={activeVideo.youtubeId}
                ref={(instance) => bindPlayer(instance)}
              />
            ) : mp4Src ? (
              <Mp4Player
                src={mp4Src}
                ref={(instance) => bindPlayer(instance)}
              />
            ) : (
              <p className="text-sm text-zinc-500">Video source missing.</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-400">
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
              <label className="ml-auto flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
                <input
                  type="checkbox"
                  checked={follow}
                  onChange={(e) => setFollow(e.target.checked)}
                />
                Follow scrub
              </label>
            </div>
          </div>
          <div>
            {hasGps(data) ? (
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
                activeProgress={progress}
                onProgress={onMapProgress}
                {...mapProps}
              />
            ) : (
              <MissingGps />
            )}
          </div>
        </div>
      ) : hasGps(data) ? (
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
          activeProgress={progress}
          onProgress={onMapProgress}
          {...mapProps}
        />
      ) : (
        <MissingGps />
      )}

      {activeVideo && onVideoChange ? (
        <SyncPanel
          video={activeVideo}
          videoTime={videoTime}
          lapStartOffsetSec={currentSyncLap.startOffsetSec}
          lapTimeMs={lap.lap_time_ms}
          sessionStartedAtMs={sessionStartedAtMs}
          loggedLaps={syncLaps.map((item) => ({
            startOffsetSec: item.startOffsetSec,
            lapTimeMs: item.lapTimeMs,
          }))}
          onChange={onVideoChange}
          onSeek={seek}
        />
      ) : null}

      <SpeedChart
        points={chartData}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
      <GChart
        points={chartData}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
    </div>
  );
}
