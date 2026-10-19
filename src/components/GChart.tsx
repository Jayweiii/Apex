"use client";

import { hoverIndex } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import { formatG } from "@/lib/format";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
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

export function GChart({
  points,
  activeIndex = null,
  onHoverIndex,
  syncId = "lap",
  compact = false,
}: {
  points: { t: number; latG: number; lonG: number }[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
  /** Short height for stacked telemetry columns. */
  compact?: boolean;
}) {
  const active = activeIndex != null ? points[activeIndex] : null;
  const scrub = bindChartScrub(points.length, onHoverIndex);

  return (
    <div
      className={`w-full max-w-full overflow-hidden border border-zinc-800/80 bg-zinc-950/40 ${
        compact
          ? "rounded-xl px-2.5 py-2"
          : "h-[260px] rounded-2xl p-3 sm:h-[320px] sm:p-4"
      }`}
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          G-force
        </p>
        <p className="truncate font-mono text-[10px] text-zinc-400">
          {active
            ? `${formatG(active.latG, true)} · ${formatG(active.lonG, true)}`
            : "lat · long"}
        </p>
      </div>
      <div
        className={`touch-none ${compact ? "h-[88px]" : "h-[200px] sm:h-[260px]"}`}
        {...scrub}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            onMouseMove={(state) => {
              // Hover alone must not scrub — chart-scrub handles drag via pointer.
              const native = (state as { event?: MouseEvent }).event;
              if (native && native.buttons === 0) return;
              onHoverIndex?.(hoverIndex(state));
            }}
            onMouseLeave={() => onHoverIndex?.(null)}
          >
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis
              dataKey="t"
              type="number"
              tickFormatter={(value: number) => `${value.toFixed(0)}s`}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 12 }}
            />
            <YAxis
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 12 }}
              width={48}
              tickFormatter={(value: number) => value.toFixed(1)}
            />
            <ReferenceLine y={0} stroke="#3f3f46" />
            {active ? (
              <ReferenceLine x={active.t} stroke="#e4e4e7" strokeDasharray="3 3" />
            ) : null}
            <Tooltip
              cursor={false}
              contentStyle={tooltipStyle}
              formatter={(value, name) => [formatG(Number(value), true), name]}
              labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="latG"
              name="Lateral"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="lonG"
              name="Longitudinal"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
