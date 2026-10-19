"use client";

import { ChannelChart } from "@/components/ChannelChart";
import { GChart } from "@/components/GChart";
import { SpeedChart } from "@/components/SpeedChart";
import {
  channelLabel,
  detectCompareChannels,
  detectLapChannels,
  type TelemetryChannelId,
} from "@/lib/telemetry-channels";
import type { TelemetryPoint } from "@/lib/types";
import { useMemo } from "react";

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function StackedLapTelemetry({
  points,
  activeIndex = null,
  onHoverIndex,
  syncId = "lap-detail",
  trimMarkers,
  onTrimBoundaryDrag,
  className,
}: {
  points: TelemetryPoint[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
  trimMarkers?: { startT: number; endT: number } | null;
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  className?: string;
}) {
  const channels = useMemo(() => detectLapChannels(points), [points]);
  const activeT =
    activeIndex != null && points[activeIndex] ? points[activeIndex].t : null;
  const last = channels.length - 1;
  if (!channels.length) return null;

  return (
    <div
      className={`flex min-h-0 flex-col gap-2 overflow-y-auto ${className ?? ""}`}
      aria-label="Telemetry channels"
    >
      {channels.map((id, idx) => (
        <LapChannel
          key={id}
          id={id}
          points={points}
          activeIndex={activeIndex}
          activeT={activeT}
          onHoverIndex={onHoverIndex}
          syncId={syncId}
          showXAxis={idx === last}
          trimMarkers={id === "speed" ? trimMarkers : null}
          onTrimBoundaryDrag={id === "speed" ? onTrimBoundaryDrag : undefined}
        />
      ))}
    </div>
  );
}

function LapChannel({
  id,
  points,
  activeIndex,
  activeT,
  onHoverIndex,
  syncId,
  showXAxis,
  trimMarkers,
  onTrimBoundaryDrag,
}: {
  id: TelemetryChannelId;
  points: TelemetryPoint[];
  activeIndex?: number | null;
  activeT: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId: string;
  showXAxis: boolean;
  trimMarkers?: { startT: number; endT: number } | null;
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
}) {
  if (id === "speed") {
    return (
      <SpeedChart
        points={points}
        activeIndex={activeIndex}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        trimMarkers={trimMarkers ?? undefined}
        onTrimBoundaryDrag={onTrimBoundaryDrag}
        compact
      />
    );
  }
  if (id === "g") {
    return (
      <GChart
        points={points as { t: number; latG: number; lonG: number }[]}
        activeIndex={activeIndex}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        compact
      />
    );
  }
  if (id === "throttleBrake") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="%"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[
          { dataKey: "throttle", name: "Throttle", stroke: "#22c55e" },
          { dataKey: "brake", name: "Brake", stroke: "#ef4444" },
        ]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
      />
    );
  }
  if (id === "steering") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="deg"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[{ dataKey: "steering", name: "Steering", stroke: "#38bdf8" }]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
      />
    );
  }
  if (id === "gearRpm") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[
          { dataKey: "rpm", name: "RPM", stroke: "#fbbf24" },
          { dataKey: "gear", name: "Gear", stroke: "#a78bfa" },
        ]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
        showLegend
      />
    );
  }
  if (id === "heading") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="deg"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[{ dataKey: "heading", name: "Heading", stroke: "#94a3b8" }]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
      />
    );
  }
  return null;
}

type CompareLapMeta = { id: string; lapNumber: number; color: string };

export function StackedCompareTelemetry({
  series,
  laps,
  rawLaps,
  activeIndex = null,
  onHoverIndex,
  syncId = "compare",
  analysisHint,
  className,
}: {
  series: Record<string, number | boolean | undefined>[];
  laps: CompareLapMeta[];
  rawLaps: TelemetryPoint[][];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
  analysisHint?: string;
  className?: string;
}) {
  const channels = useMemo(
    () => detectCompareChannels(rawLaps, { includeDelta: laps.length >= 2 }),
    [rawLaps, laps.length],
  );
  const hoverDist =
    activeIndex != null && series[activeIndex]
      ? Number(series[activeIndex].dist)
      : null;
  const last = channels.length - 1;
  if (!channels.length || series.length < 2) return null;

  return (
    <div
      className={`flex min-h-0 flex-col gap-2 overflow-y-auto ${className ?? ""}`}
      aria-label="Compare telemetry channels"
    >
      {channels.map((id, idx) => (
        <CompareChannel
          key={id}
          id={id}
          series={series}
          laps={laps}
          activeX={hoverDist}
          onHoverIndex={onHoverIndex}
          syncId={syncId}
          showXAxis={idx === last}
          analysisHint={analysisHint}
        />
      ))}
    </div>
  );
}

function CompareChannel({
  id,
  series,
  laps,
  activeX,
  onHoverIndex,
  syncId,
  showXAxis,
  analysisHint,
}: {
  id: TelemetryChannelId;
  series: Record<string, number | boolean | undefined>[];
  laps: CompareLapMeta[];
  activeX: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId: string;
  showXAxis: boolean;
  analysisHint?: string;
}) {
  const xTick = (value: number) => formatDistance(value);
  const points = series as unknown as Record<string, unknown>[];

  if (id === "delta") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint={analysisHint ?? "+ behind ref"}
        points={points}
        xKey="dist"
        xTick={xTick}
        series={laps.slice(1).map((lap, index) => ({
          dataKey: `delta${index + 1}`,
          name: `Δ ${lap.lapNumber}`,
          stroke: lap.color,
        }))}
        activeX={activeX}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
        showLegend
      />
    );
  }
  if (id === "throttleBrake") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="%"
        points={points}
        xKey="dist"
        xTick={xTick}
        series={laps.flatMap((lap, index) => [
          { dataKey: `throttle${index}`, name: `T ${lap.lapNumber}`, stroke: lap.color },
          { dataKey: `brake${index}`, name: `B ${lap.lapNumber}`, stroke: lap.color },
        ])}
        activeX={activeX}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
        showLegend
      />
    );
  }
  if (id === "gearRpm") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="RPM"
        points={points}
        xKey="dist"
        xTick={xTick}
        series={laps.map((lap, index) => ({
          dataKey: `rpm${index}`,
          name: `RPM ${lap.lapNumber}`,
          stroke: lap.color,
        }))}
        activeX={activeX}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        showXAxis={showXAxis}
        showLegend
      />
    );
  }
  const prefix =
    id === "speed" ? "speed" : id === "g" ? "g" : id === "steering" ? "steering" : id === "heading" ? "heading" : null;
  if (!prefix) return null;
  return (
    <ChannelChart
      title={channelLabel(id)}
      hint={id === "speed" ? analysisHint : id === "g" ? "combined" : "deg"}
      points={points}
      xKey="dist"
      xTick={xTick}
      series={laps.map((lap, index) => ({
        dataKey: `${prefix}${index}`,
        name: `Lap ${lap.lapNumber}`,
        stroke: lap.color,
      }))}
      activeX={activeX}
      onHoverIndex={onHoverIndex}
      syncId={syncId}
      showXAxis={showXAxis}
      showLegend
    />
  );
}

/** Helper kept for any callers that detect channels from flat compare series. */
export function compareChannelsForSeries(
  series: Record<string, number | boolean | undefined>[],
  lapCount: number,
): TelemetryChannelId[] {
  if (!series.length || lapCount < 1) return [];
  const sampleLaps: TelemetryPoint[][] = Array.from({ length: lapCount }, (_, index) =>
    series.slice(0, 12).map((row) => {
      const point: TelemetryPoint = { t: 0, speed: Number(row[`speed${index}`] ?? 0) };
      for (const key of ["throttle", "brake", "steering", "rpm", "gear", "heading", "g"] as const) {
        const value = row[`${key}${index}`];
        if (typeof value === "number") (point as Record<string, number>)[key] = value;
      }
      if (point.g != null && point.latG == null) point.latG = point.g;
      return point;
    }),
  );
  return detectCompareChannels(sampleLaps, { includeDelta: lapCount >= 2 });
}
