"use client";

import { createHoverCursorController } from "@/components/hover-cursor";
import { StackedLapTelemetry } from "@/components/StackedTelemetry";
import { SyncedVideo } from "@/components/SyncedVideo";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { useAnalysisMode } from "@/lib/analysis-mode";
import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import { hasGps } from "@/lib/compare";
import { enrichTelemetry } from "@/lib/gforce";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import {
  indexNearestTime,
  lapDurationSec,
  plotFractionFromTime,
  progressFromTimeSec,
  seriesT0,
  timeSecFromProgress,
} from "@/lib/playback-timebase";
import type { TelemetryPoint } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";

export function LapCharts({
  points,
  label,
  videoSrc,
  trackId,
}: {
  points: TelemetryPoint[];
  label: string;
  videoSrc?: string | null;
  trackId?: string | null;
}) {
  const centerline = useMemo(
    () => resolveTrackCenterline(trackId, null, [points]),
    [trackId, points],
  );
  const matched = useMemo(
    () => mapMatchLap(points, centerline),
    [points, centerline],
  );
  const [gpsMode, setGpsMode] = useState<GpsDisplayMode>("snapped");
  const {
    mode: analysisMode,
    setMode: setAnalysisMode,
    hasSnap: hasAnalysisSnap,
  } = useAnalysisMode(Boolean(centerline));
  const analysis = useMemo(
    () => enrichTelemetry(analysisPoints(matched, points, analysisMode)),
    [matched, points, analysisMode],
  );
  const data = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(matched, points, centerline ? gpsMode : "raw"),
      ),
    [matched, points, gpsMode, centerline],
  );
  const [progress, setProgress] = useState<number | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const chartPoints = analysis;
  const durationSec = useMemo(() => {
    if (chartPoints.length < 2) return 1;
    const span =
      chartPoints[chartPoints.length - 1]!.t - seriesT0(chartPoints);
    return lapDurationSec(Math.round(Math.max(1, span * 1000)));
  }, [chartPoints]);
  const durationMs = Math.round(durationSec * 1000);
  const t0 = useMemo(() => {
    const first = seriesT0(chartPoints);
    return Math.abs(first) < 0.05 ? 0 : first;
  }, [chartPoints]);

  const hoverController = useMemo(() => createHoverCursorController(), []);
  useEffect(() => () => hoverController.dispose(), [hoverController]);

  // Playback solid cursor only — hover dashed line is DOM/rAF.
  const playbackIndex =
    progress == null || chartPoints.length < 2
      ? null
      : indexNearestTime(
          chartPoints,
          timeSecFromProgress(progress, durationSec, t0),
        );

  useEffect(() => {
    if (progress == null || chartPoints.length < 2) {
      hoverController.setPlaybackFraction(null);
      hoverController.setPlaybackIndex(null);
      return;
    }
    const targetT = timeSecFromProgress(progress, durationSec, t0);
    const firstT = chartPoints[0]!.t;
    const lastT = chartPoints[chartPoints.length - 1]!.t;
    hoverController.setPlaybackFraction(
      plotFractionFromTime(targetT, firstT, lastT),
    );
    hoverController.setPlaybackIndex(indexNearestTime(chartPoints, targetT));
  }, [progress, chartPoints, durationSec, t0, hoverController]);

  const previewFromChart = useCallback(
    (next: number | null) => {
      if (next == null || chartPoints.length < 2) {
        setPreviewProgress(null);
        return;
      }
      const point = chartPoints[Math.min(chartPoints.length - 1, Math.max(0, next))];
      setPreviewProgress(
        point
          ? progressFromTimeSec(point.t, durationSec, t0)
          : null,
      );
    },
    [chartPoints, durationSec, t0],
  );

  const seekFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(null);
      if (next == null || chartPoints.length < 2) {
        setProgress(null);
        return;
      }
      const point = chartPoints[Math.min(chartPoints.length - 1, Math.max(0, next))];
      setProgress(
        point ? progressFromTimeSec(point.t, durationSec, t0) : null,
      );
    },
    [chartPoints, durationSec, t0],
  );

  const mapBlock = hasGps(data) ? (
    <TrackMap
      traces={[
        {
          id: "lap",
          label,
          color: "#f97316",
          points: data,
          colorBySpeed: true,
        },
      ]}
      activeProgress={progress}
      progressBasis="time"
      durationMs={durationMs}
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
      onAnalysisModeChange={centerline ? setAnalysisMode : undefined}
      analysisDisabled={!hasAnalysisSnap}
    />
  ) : (
    <MissingGps />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] lg:items-start">
      <div className="min-w-0 space-y-3 lg:sticky lg:top-20">
        {videoSrc ? (
          <SyncedVideo
            src={videoSrc}
            progress={progress}
            durationHint={durationSec}
            onProgress={(next) => {
              setPreviewProgress(null);
              setProgress(next);
            }}
          />
        ) : null}
        {mapBlock}
      </div>
      <StackedLapTelemetry
        points={chartPoints}
        activeIndex={playbackIndex}
        onPreviewIndex={previewFromChart}
        onSeekIndex={seekFromChart}
        syncId="lap-detail"
        hoverController={hoverController}
      />
    </div>
  );
}
