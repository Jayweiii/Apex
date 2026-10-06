"use client";

import { hoverIndex } from "@/components/chart-hover";
import {
  Area,
  AreaChart,
  CartesianGrid,
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

export function SpeedChart({
  points,
  activeIndex = null,
  onHoverIndex,
  syncId = "lap",
}: {
  points: { t: number; speed: number }[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
}) {
  const active = activeIndex != null ? points[activeIndex] : null;

  return (
    <div className="h-[260px] w-full max-w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:h-[320px] sm:p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Speed</p>
        <p className="font-mono text-xs text-zinc-300">
          {active ? `${active.speed.toFixed(0)} km/h` : "km/h"}
        </p>
      </div>
      <div className="h-[200px] sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            onMouseMove={(state) => onHoverIndex?.(hoverIndex(state))}
            onMouseLeave={() => onHoverIndex?.(null)}
          >
            <defs>
              <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis
              dataKey="t"
              type="number"
              tickFormatter={(value: number) => `${value.toFixed(0)}s`}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 12 }}
            />
            <YAxis
              dataKey="speed"
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 12 }}
              tickFormatter={(value: number) => `${Math.round(value)}`}
              width={42}
            />
            <Tooltip
              cursor={false}
              contentStyle={tooltipStyle}
              formatter={(value) => [`${Number(value).toFixed(1)} km/h`, "Speed"]}
              labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
            />
            {active ? (
              <ReferenceLine x={active.t} stroke="#e4e4e7" strokeDasharray="3 3" />
            ) : null}
            <Area
              type="monotone"
              dataKey="speed"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#speedFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
