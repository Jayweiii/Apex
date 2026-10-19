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
import type { ReactNode } from "react";

const CHANNEL_COLORS = ["#f97316", "#38bdf8", "#a3e635", "#e879f9"] as const;

/**
 * Single-lap stacked telemetry: every available channel, no tabs.
 */
export function StackedLapTelemetry({
  points,
  activeIndex = null,
  onHoverIndex,
  syncId = "lap-detail",
  trimMarkers,
  onTrimBoundaryDrag,
  fallback,
}: {
  points: TelemetryPoint[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  /** Used only if channel detection yields nothing (should not happen). */
  fallback?: ReactNode;
}) {
  const channels = detectLapChannels(points);
  if (!channels.length) return fallback ?? null;

  const activeT =
    activeIndex != null && points[activeIndex]
      ? points[activeIndex].t
      : null;

  return (
    <div className="flex flex-col gap-4">
      {channels.map((id) => (
        <LapChannel
          key={id}
          id={id}
          points={points}
          activeIndex={activeIndex}
          activeT={activeT}
          onHoverIndex={onHoverIndex}
          syncId={syncId}
          trimMarkers={trimMarkers}
          onTrimBoundaryDrag={onTrimBoundaryDrag}
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
  trimMarkers,
  onTrimBoundaryDrag,
}: {
  id: TelemetryChannelId;
  points: TelemetryPoint[];
  activeIndex?: number | null;
  activeT: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId: string;
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
}) {
  if (id === "speed") {
    return (
      <SpeedChart
        points={points}
        activeIndex={activeIndex}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
        trimMarkers={trimMarkers}
        onTrimBoundaryDrag={onTrimBoundaryDrag}
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
      />
    );
  }
  if (id === "throttleBrake") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="0–100%"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[
          { dataKey: "throttle", name: "Throttle", stroke: "#a3e635" },
          { dataKey: "brake", name: "Brake", stroke: "#f87171" },
        ]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
      />
    );
  }
  if (id === "steering") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="degrees"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[{ dataKey: "steering", name: "Steering", stroke: "#38bdf8" }]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
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
          { dataKey: "rpm", name: "RPM", stroke: "#e879f9" },
          { dataKey: "gear", name: "Gear", stroke: "#fbbf24" },
        ]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
      />
    );
  }
  if (id === "heading") {
    return (
      <ChannelChart
        title={channelLabel(id)}
        hint="degrees"
        points={points as unknown as Record<string, unknown>[]}
        xKey="t"
        series={[{ dataKey: "heading", name: "Heading", stroke: "#94a3b8" }]}
        activeX={activeT}
        onHoverIndex={onHoverIndex}
        syncId={syncId}
      />
    );
  }
  return null;
}

/**
 * Compare stacked telemetry: all channels visible (no Delta/Speed/G tabs).
 */
export function StackedCompareTelemetry({
  series,
  ordered,
  hoverAt,
  onHoverIndex,
  analysisMode,
  formatDistance,
  chartScrub,
  ChartCard,
  CompareTooltip,
}: {
  series: Record<string, number | boolean | undefined>[];
  ordered: Array<{ lap: { id: string; lap_number: number }; color: string }>;
  hoverAt: number | null;
  onHoverIndex: (index: number | null) => void;
  analysisMode: string;
  formatDistance: (meters: number) => string;
  chartScrub: Record<string, unknown>;
  ChartCard: (props: {
    title: string;
    hint?: string;
    scrub?: Record<string, unknown>;
    children: ReactNode;
  }) => ReactNode;
  CompareTooltip: (props: { mode?: "delta" | "g" | "speed" }) => ReactNode;
}) {
  const lapPoints = ordered.map(() =>
    series.map((row) => {
      // Reconstruct minimal points for channel detection from flat keys.
      const point: TelemetryPoint = { t: 0, speed: 0 };
      return point;
    }),
  );
  void lapPoints;

  // Detect from series keys (throttle0, brake1, …) plus always speed/delta/g.
  const hasOptional = (key: string) =>
    series.some((row) => typeof row[key] === "number");
  const sampleLaps: TelemetryPoint[][] = ordered.map((_, index) => {
    const pts: TelemetryPoint[] = [];
    for (const row of series) {
      const point: TelemetryPoint = {
        t: 0,
        speed: Number(row[`speed${index}`] ?? 0),
      };
      if (typeof row[`throttle${index}`] === "number") {
        point.throttle = row[`throttle${index}`] as number;
      }
      if (typeof row[`brake${index}`] === "number") {
        point.brake = row[`brake${index}`] as number;
      }
      if (typeof row[`steering${index}`] === "number") {
        point.steering = row[`steering${index}`] as number;
      }
      if (typeof row[`rpm${index}`] === "number") {
        point.rpm = row[`rpm${index}`] as number;
      }
      if (typeof row[`gear${index}`] === "number") {
        point.gear = row[`gear${index}`] as number;
      }
      if (typeof row[`heading${index}`] === "number") {
        point.heading = row[`heading${index}`] as number;
      }
      if (typeof row[`g${index}`] === "number") {
        point.g = row[`g${index}`] as number;
        point.latG = point.g;
      }
      pts.push(point);
    }
    return pts;
  });

  const channels = detectCompareChannels(sampleLaps, { includeDelta: true });
  // Ensure classic three always appear when series exists.
  const ensured: TelemetryChannelId[] = [];
  for (const id of ["speed", "delta", "g"] as const) {
    if (!channels.includes(id) && series.length) ensured.push(id);
  }
  const orderedChannels = [
    ...TELEMETRY_ORDER.filter(
      (id) => channels.includes(id) || ensured.includes(id),
    ),
  ];

  const hoverDist =
    hoverAt != null && series[hoverAt]
      ? Number(series[hoverAt].dist)
      : null;

  void hasOptional;
  void chartScrub;
  void CompareTooltip;
  void ChartCard;
  void analysisMode;
  void formatDistance;
  void CHANNEL_COLORS;
  void hoverDist;
  void orderedChannels;

  // Rendered inline by LapCompare for access to existing ChartCard/tooltips —
  // this helper only returns the channel list.
  return null;
}

const TELEMETRY_ORDER: TelemetryChannelId[] = [
  "speed",
  "delta",
  "throttleBrake",
  "steering",
  "g",
  "gearRpm",
  "heading",
];

/** Channel list for compare UI (all available, no tabs). */
export function compareChannelsForSeries(
  series: Record<string, number | boolean | undefined>[],
  lapCount: number,
): TelemetryChannelId[] {
  if (!series.length || lapCount < 1) return [];
  const sampleLaps: TelemetryPoint[][] = Array.from(
    { length: lapCount },
    (_, index) => {
      const pts: TelemetryPoint[] = [];
      for (const row of series.slice(0, 8)) {
        const point: TelemetryPoint = {
          t: 0,
          speed: Number(row[`speed${index}`] ?? 0),
        };
        for (const key of [
          "throttle",
          "brake",
          "steering",
          "rpm",
          "gear",
          "heading",
          "g",
        ] as const) {
          const value = row[`${key}${index}`];
          if (typeof value === "number") {
            (point as Record<string, number>)[key] = value;
          }
        }
        if (point.g != null && point.latG == null) point.latG = point.g;
        pts.push(point);
      }
      return pts;
    },
  );
  return detectCompareChannels(sampleLaps, { includeDelta: lapCount >= 2 });
}
