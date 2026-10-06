"use client";

import type { TelemetryPoint } from "@/lib/types";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function SpeedChart({ points }: { points: TelemetryPoint[] }) {
  const data = points.map((point) => ({
    t: point.t,
    speed: point.speed,
  }));

  return (
    <div className="h-[360px] w-full rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
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
            contentStyle={{
              background: "#09090b",
              border: "1px solid #27272a",
              borderRadius: 12,
              color: "#fafafa",
            }}
            formatter={(value) => [`${Number(value).toFixed(1)} km/h`, "Speed"]}
            labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
          />
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
  );
}
