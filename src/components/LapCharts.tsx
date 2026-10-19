"use client";

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
import type { TelemetryPoint } from "@/lib/types";
import { progressFromIndex } from "@/lib/scrub";
import { useCallback, useMemo, useState } from "react";

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
  // Playback solid cursor only — hover dashed line is DOM/rAF.
  const playbackIndex =
    progress == null || chartPoints.length < 2
      ? null
      : Math.round(progress * (chartPoints.length - 1));
  const durationHint =
    chartPoints.length > 1
      ? chartPoints[chartPoints.length - 1].t - chartPoints[0].t
      : undefined;

  const previewFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(progressFromIndex(next, chartPoints.length));
    },
    [chartPoints.length],
  );

  const seekFromChart = useCallback(
    (next: number | null) => {
      setPreviewProgress(null);
      setProgress(progressFromIndex(next, chartPoints.length));
    },
    [chartPoints.length],
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
            durationHint={durationHint}
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
      />
    </div>
  );
}
