"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import {
  HoverCursorLine,
  PlaybackCursorLine,
  useHoverCursor,
} from "@/components/HoverCursor";
import { type PlotPad } from "@/components/hover-cursor";
import { useCallback, useRef } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "#09090b",
  border: "1px solid #27272a",
  borderRadius: 12,
  color: "#fafafa",
};

export const CHANNEL_PLOT_PAD: PlotPad = { left: 36, right: 4 };

type Series = {
  dataKey: string;
  name: string;
  stroke: string;
};

/**
 * Generic single- or multi-series telemetry channel chart (time or distance axis).
 */
export function ChannelChart({
  title,
  hint,
  points,
  xKey,
  xTick,
  series,
  activeX,
  onPreviewIndex,
  onSeekIndex,
  syncId = "lap",
  yUnit,
  heightClass = "h-[240px] min-h-[240px] sm:h-[260px] sm:min-h-[260px]",
  showLegend = false,
  showXAxis = true,
  compact = true,
}: {
  title: string;
  hint?: string;
  points: Record<string, unknown>[];
  xKey: string;
  xTick?: (value: number) => string;
  series: Series[];
  activeX?: number | null;
  onPreviewIndex?: (index: number | null) => void;
  onSeekIndex?: (index: number | null) => void;
  syncId?: string;
  yUnit?: string;
  heightClass?: string;
  showLegend?: boolean;
  showXAxis?: boolean;
  compact?: boolean;
}) {
  // Playback cursor is the DOM overlay; activeX kept for API compat.
  void activeX;
  const hoverCursor = useHoverCursor();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scrub = bindChartScrub(points.length, {
    onPreviewIndex: hoverCursor ? undefined : onPreviewIndex,
    onSeekIndex,
  });

  const driveHover = useCallback(
    (clientX: number) => {
      const plot = plotRef.current;
      if (!plot || !hoverCursor || points.length < 1) return;
      hoverCursor.move({
        clientX,
        plotEl: plot,
        pad: CHANNEL_PLOT_PAD,
        length: points.length,
      });
    },
    [hoverCursor, points.length],
  );

  if (!points.length || !series.length) return null;

  return (
    <div
      className={`w-full max-w-full overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 ${
        compact ? "px-2.5 py-2" : "rounded-2xl p-3 sm:p-4"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {title}
        </p>
        {hint ? (
          <p className="truncate font-mono text-[10px] text-zinc-400">{hint}</p>
        ) : null}
      </div>
      <div
        ref={plotRef}
        className={`relative touch-none ${heightClass}`}
        data-apex-chart-plot="channel"
        {...scrub}
        onPointerMove={(event) => {
          scrub.onPointerMove?.(event);
          if ((event.buttons ?? 0) === 0) driveHover(event.clientX);
        }}
        onMouseLeave={() => {
          if (!hoverCursor) scrub.onMouseLeave?.();
        }}
      >
        <ResponsiveContainer width="100%" height="100%" minHeight={220}>
          <LineChart
            data={points}
            syncId={syncId}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              if (hoverCursor) return;
              const index = hoverIndex(state);
              if (isSeekPointer(state)) onSeekIndex?.(index);
              else onPreviewIndex?.(index);
            }}
            onMouseLeave={() => {
              if (!hoverCursor) onPreviewIndex?.(null);
            }}
          >
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis
              dataKey={xKey}
              type="number"
              hide={!showXAxis}
              height={showXAxis ? 18 : 0}
              tickFormatter={
                xTick ?? ((value: number) => `${Number(value).toFixed(0)}s`)
              }
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 10 }}
            />
            <YAxis
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 10 }}
              width={36}
              unit={yUnit}
            />
            <Tooltip
              cursor={false}
              contentStyle={tooltipStyle}
              labelFormatter={(label) =>
                xTick
                  ? xTick(Number(label))
                  : `${Number(label).toFixed(1)}s`
              }
            />
            {showLegend || series.length > 1 ? (
              <Legend wrapperStyle={{ fontSize: 10 }} />
            ) : null}
            {series.map((item) => (
              <Line
                key={item.dataKey}
                type="monotone"
                dataKey={item.dataKey}
                name={item.name}
                stroke={item.stroke}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <HoverCursorLine plotRef={plotRef} pad={CHANNEL_PLOT_PAD} />
        <PlaybackCursorLine plotRef={plotRef} pad={CHANNEL_PLOT_PAD} />
      </div>
    </div>
  );
}
