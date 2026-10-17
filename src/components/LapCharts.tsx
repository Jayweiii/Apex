"use client";

import { GChart } from "@/components/GChart";
import { SpeedChart } from "@/components/SpeedChart";
import { SyncedVideo } from "@/components/SyncedVideo";
import { MissingGps, TrackMap } from "@/components/TrackMap";
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
import { useMemo, useState } from "react";

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
  const analysis = useMemo(
    () => enrichTelemetry(analysisPoints(matched, points)),
    [matched, points],
  );
  const data = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(matched, points, centerline ? gpsMode : "raw"),
      ),
    [matched, points, gpsMode, centerline],
  );
  const [progress, setProgress] = useState<number | null>(null);
  const chartPoints = analysis;
  const index =
    progress == null || chartPoints.length < 2
      ? null
      : Math.round(progress * (chartPoints.length - 1));
  const durationHint =
    chartPoints.length > 1
      ? chartPoints[chartPoints.length - 1].t - chartPoints[0].t
      : undefined;

  function hoverFromChart(next: number | null) {
    if (next == null || chartPoints.length < 2) {
      setProgress(null);
      return;
    }
    setProgress(next / (chartPoints.length - 1));
  }

  return (
    <>
      {videoSrc ? (
        <SyncedVideo
          src={videoSrc}
          progress={progress}
          durationHint={durationHint}
          onProgress={setProgress}
        />
      ) : null}
      {hasGps(data) ? (
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
          onProgress={setProgress}
          centerline={centerline}
          gpsMode={centerline ? gpsMode : undefined}
          onGpsModeChange={centerline ? setGpsMode : undefined}
        />
      ) : (
        <MissingGps />
      )}
      <SpeedChart
        points={chartPoints}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
      <GChart
        points={chartPoints}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
    </>
  );
}
