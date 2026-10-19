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
  followCharts = false,
  onVideoChange,
  trackId,
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
  // Optimistic copy so SyncPanel nudges update UI before parent re-fetches.
  const [draftVideo, setDraftVideo] = useState<SessionVideo | null>(
    video ?? null,
  );
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

  const handleVideoChange = useCallback(
    (next: SessionVideo) => {
      setDraftVideo(next);
      onVideoChange?.(next);
    },
    [onVideoChange],
  );

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
      // Only drive video when Follow is on — off lets you pair video+chart for sync.
      if (!follow || nextProgress == null || !activeVideo) return;
      const t = videoTimeFromLapProgress(
        currentSyncLap,
        nextProgress,
        activeVideo,
      );
      seek(t);
      setVideoTime(t);
    },
    [chartData.length, activeVideo, follow, currentSyncLap, seek],
  );

  const onMapProgress = useCallback(
    (next: number | null) => {
      setProgress(next);
      if (!follow || next == null || !activeVideo) return;
      const t = videoTimeFromLapProgress(currentSyncLap, next, activeVideo);
      seek(t);
      setVideoTime(t);
    },
    [activeVideo, follow, currentSyncLap, seek],
  );

  const chartLapTimeSec =
    progress == null
      ? null
      : progress *
        (chartData[chartData.length - 1]?.t ??
          lap.lap_time_ms / 1000);

  const seekChartLapTime = useCallback(
    (lapTimeSec: number) => {
      const lastT =
        chartData[chartData.length - 1]?.t ?? lap.lap_time_ms / 1000;
      if (lastT <= 0) return;
      setProgress(Math.max(0, Math.min(1, lapTimeSec / lastT)));
    },
    [chartData, lap.lap_time_ms],
  );

  const mapProps = {
    centerline,
    gpsMode: centerline ? gpsMode : undefined,
    onGpsModeChange: centerline ? setGpsMode : undefined,
    analysisMode: centerline ? analysisMode : undefined,
    onAnalysisModeChange: centerline ? setAnalysisMode : undefined,
    analysisDisabled: !hasAnalysisSnap,
  } as const;

  // Stable callback ref — an inline `ref={(h) => …}` is a new function each
  // render and React 19 re-invokes it (null then instance) → update loops.
  const bindPlayer = useCallback((handle: VideoPlayerHandle | null) => {
    playerRef.current = handle;
    setPlayer((prev) => (prev === handle ? prev : handle));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {activeVideo ? (
        <div className="space-y-4">
          <div className="w-full">
            {activeVideo.provider === "youtube" && activeVideo.youtubeId ? (
              <YouTubePlayer
                key={activeVideo.youtubeId}
                videoId={activeVideo.youtubeId}
                ref={bindPlayer}
                className="w-full"
              />
            ) : mp4Src ? (
              <Mp4Player src={mp4Src} ref={bindPlayer} className="w-full" />
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
          chartLapTimeSec={chartLapTimeSec}
          lapPoints={chartData}
          onChange={handleVideoChange}
          onSeek={seek}
          onSeekChartLapTime={seekChartLapTime}
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
