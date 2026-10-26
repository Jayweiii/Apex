"use client";

import { ChannelChart } from "@/components/ChannelChart";
import { GChart } from "@/components/GChart";
import { HoverCursorScope } from "@/components/HoverCursor";
import type { HoverCursorController } from "@/components/hover-cursor";
import { SpeedChart } from "@/components/SpeedChart";
import {
  channelLabel,
  detectCompareChannels,
  detectLapChannels,
  type TelemetryChannelId,
} from "@/lib/telemetry-channels";
import {
  STACKED_SPEED_MIN_HEIGHT,
  STACKED_SPEED_MIN_HEIGHT_SM,
} from "@/lib/chart-height-contract";
import type { TelemetryPoint } from "@/lib/types";
import {
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { useHoverCursor } from "@/components/HoverCursor";

const CHANNEL_COLORS = ["#f97316", "#38bdf8", "#a3e635", "#e879f9"] as const;

/**
 * Single-lap stacked telemetry: every available channel, no tabs.
 */
export function StackedLapTelemetry({
  points,
  activeIndex = null,
  onPreviewIndex,
  onSeekIndex,
  syncId = "lap-detail",
  trimMarkers,
  onTrimBoundaryDrag,
  fallback,
  className,
  hoverReadoutRef,
  formatHoverReadout,
  formatPlaybackReadout,
  hoverEnabled = true,
  hoverController,
}: {
  points: TelemetryPoint[];
  /** Playback cursor index only — never hover (hover is DOM/rAF). */
  activeIndex?: number | null;
  onPreviewIndex?: (index: number | null) => void;
  onSeekIndex?: (index: number | null) => void;
  syncId?: string;
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  /** Used only if channel detection yields nothing (should not happen). */
  fallback?: ReactNode;
  className?: string;
  /** External readout painted in the same rAF as hover lines. */
  hoverReadoutRef?: RefObject<HTMLElement | null>;
  formatHoverReadout?: (index: number) => string;
  formatPlaybackReadout?: (index: number | null) => string;
  /** False while playback is playing — no hover preview. */
  hoverEnabled?: boolean;
  /** Parent-owned cursor controller (drives solid playback overlay via rAF). */
  hoverController?: HoverCursorController;
}) {
  const channels = detectLapChannels(points);
  if (!channels.length) return fallback ?? null;

  const activeT =
    activeIndex != null && points[activeIndex]
      ? points[activeIndex].t
      : null;

  const others = channels.filter((id) => id !== "speed");
  const hasSpeed = channels.includes("speed");

  // Speed stays dominant; other channels keep fixed min heights (no flex
  // slivers). Page scrolls — no nested overflow pane.
  // HoverCursorScope: pointer-x SoT, dashed hover lines via rAF, leave only
  // clears when leaving the whole stack (no inter-chart flicker).
  // Playback solid line is a DOM overlay (no Recharts remount per frame).
  return (
    <HoverCursorScope
      className={`flex flex-col gap-2 ${className ?? ""}`}
      playbackIndex={activeIndex}
      onPreviewIndex={hoverEnabled ? onPreviewIndex : undefined}
      hoverEnabled={hoverEnabled}
      controller={hoverController}
    >
      {hoverReadoutRef && formatHoverReadout && formatPlaybackReadout ? (
        <HoverReadoutBridge
          elRef={hoverReadoutRef}
          formatHover={formatHoverReadout}
          formatPlayback={formatPlaybackReadout}
        />
      ) : null}
      {hasSpeed ? (
        <div
          className="flex h-[280px] min-h-[280px] shrink-0 flex-col overflow-hidden sm:h-[300px] sm:min-h-[300px]"
          data-apex-speed-chart-height={String(STACKED_SPEED_MIN_HEIGHT)}
          data-apex-speed-chart-min-sm={String(STACKED_SPEED_MIN_HEIGHT_SM)}
        >
          <SpeedChart
            points={points}
            activeIndex={activeIndex}
            onSeekIndex={onSeekIndex}
            syncId={syncId}
            trimMarkers={trimMarkers}
            onTrimBoundaryDrag={onTrimBoundaryDrag}
            compact
            fill
          />
        </div>
      ) : null}
      <div className="flex shrink-0 flex-col gap-2">
        {others.map((id) => (
          <LapChannel
            key={id}
            id={id}
            points={points}
            activeIndex={activeIndex}
            activeT={activeT}
            onSeekIndex={onSeekIndex}
            syncId={syncId}
            trimMarkers={trimMarkers}
            onTrimBoundaryDrag={onTrimBoundaryDrag}
          />
        ))}
      </div>
    </HoverCursorScope>
  );
}

function HoverReadoutBridge({
  elRef,
  formatHover,
  formatPlayback,
}: {
  elRef: RefObject<HTMLElement | null>;
  formatHover: (index: number) => string;
  formatPlayback: (index: number | null) => string;
}) {
  const cursor = useHoverCursor();
  const hoverRef = useRef(formatHover);
  const playRef = useRef(formatPlayback);
  hoverRef.current = formatHover;
  playRef.current = formatPlayback;

  useEffect(() => {
    const el = elRef.current;
    if (!cursor || !el) return;
    return cursor.attachReadout(
      el,
      (index) => hoverRef.current(index),
      (index) => playRef.current(index),
    );
  }, [cursor, elRef]);

  return null;
}

function LapChannel({
  id,
  points,
  activeIndex,
  activeT,
  onSeekIndex,
  syncId,
  trimMarkers,
  onTrimBoundaryDrag,
}: {
  id: TelemetryChannelId;
  points: TelemetryPoint[];
  activeIndex?: number | null;
  activeT: number | null;
  onSeekIndex?: (index: number | null) => void;
  syncId: string;
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
}) {
  if (id === "speed") {
    return (
      <SpeedChart
        points={points}
        activeIndex={activeIndex}
        onSeekIndex={onSeekIndex}
        syncId={syncId}
        trimMarkers={trimMarkers}
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
        onSeekIndex={onSeekIndex}
        syncId={syncId}
        compact
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
        onSeekIndex={onSeekIndex}
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
        onSeekIndex={onSeekIndex}
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
        onSeekIndex={onSeekIndex}
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
        onSeekIndex={onSeekIndex}
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
