"use client";

import { GChart } from "@/components/GChart";
import { SpeedChart } from "@/components/SpeedChart";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { hasGps } from "@/lib/compare";
import { enrichTelemetry } from "@/lib/gforce";
import type { TelemetryPoint } from "@/lib/types";
import { useMemo, useState } from "react";

export function LapCharts({
  points,
  label,
}: {
  points: TelemetryPoint[];
  label: string;
}) {
  const data = useMemo(() => enrichTelemetry(points), [points]);
  const [progress, setProgress] = useState<number | null>(null);
  const index =
    progress == null || data.length < 2
      ? null
      : Math.round(progress * (data.length - 1));

  function hoverFromChart(next: number | null) {
    if (next == null || data.length < 2) {
      setProgress(null);
      return;
    }
    setProgress(next / (data.length - 1));
  }

  return (
    <>
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
        />
      ) : (
        <MissingGps />
      )}
      <SpeedChart
        points={data}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
      <GChart
        points={data}
        activeIndex={index}
        onHoverIndex={hoverFromChart}
        syncId="lap-detail"
      />
    </>
  );
}
