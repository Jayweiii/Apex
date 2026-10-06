"use client";

import { hoverIndex } from "@/components/chart-hover";
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
}: {
  points: { t: number; latG: number; lonG: number }[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
}) {
  const active = activeIndex != null ? points[activeIndex] : null;

  return (
    <div className="h-[260px] w-full max-w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:h-[320px] sm:p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">G</p>
        <p className="font-mono text-xs text-zinc-300">
          {active
            ? `${formatG(active.latG, true)} lat · ${formatG(active.lonG, true)} long`
            : "Lateral and longitudinal"}
        </p>
      </div>
      <div className="h-[200px] sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            onMouseMove={(state) => onHoverIndex?.(hoverIndex(state))}
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
