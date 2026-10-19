"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import { formatG } from "@/lib/format";
import { useMemo } from "react";
import {
  CartesianGrid,
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

function gDomain(
  points: { latG?: number; lonG?: number }[],
  keys: Array<"latG" | "lonG">,
): [number, number] {
  let min = 0;
  let max = 0;
  for (const point of points) {
    for (const key of keys) {
      const value = point[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  const pad = Math.max(0.15, (max - min) * 0.12);
  return [Number((min - pad).toFixed(2)), Number((max + pad).toFixed(2))];
}

function AxisGChart({
  points,
  dataKey,
  name,
  stroke,
  activeIndex,
  onPreviewIndex,
  onSeekIndex,
  syncId,
  heightClass,
  domain,
}: {
  points: { t: number; latG: number; lonG: number }[];
  dataKey: "latG" | "lonG";
  name: string;
  stroke: string;
  activeIndex?: number | null;
  onPreviewIndex?: (index: number | null) => void;
  onSeekIndex?: (index: number | null) => void;
  syncId: string;
  heightClass: string;
  domain: [number, number];
}) {
  const active = activeIndex != null ? points[activeIndex] : null;
  const scrub = bindChartScrub(points.length, { onPreviewIndex, onSeekIndex });
  const value = active ? active[dataKey] : null;

  return (
    <div className="min-w-0">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {name}
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          {value != null ? formatG(value, true) : "g"}
        </p>
      </div>
      <div className={`touch-none ${heightClass}`} {...scrub}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            syncId={syncId}
            margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              const index = hoverIndex(state);
              if (isSeekPointer(state)) onSeekIndex?.(index);
              else onPreviewIndex?.(index);
            }}
            onMouseLeave={() => onPreviewIndex?.(null)}
          >
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis
              dataKey="t"
              type="number"
              tickFormatter={(v: number) => `${v.toFixed(0)}s`}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 10 }}
              height={16}
            />
            <YAxis
              domain={domain}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 10 }}
              width={40}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <ReferenceLine y={0} stroke="#3f3f46" />
            {active ? (
              <ReferenceLine
                x={active.t}
                stroke="#e4e4e7"
                strokeDasharray="3 3"
              />
            ) : null}
            <Tooltip
              cursor={false}
              contentStyle={tooltipStyle}
              formatter={(v) => [formatG(Number(v), true), name]}
              labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              name={name}
              stroke={stroke}
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

/** Lateral + longitudinal G stacked as two readable rows. */
export function GChart({
  points,
  activeIndex = null,
  onPreviewIndex,
  onSeekIndex,
  syncId = "lap",
  compact = false,
}: {
  points: { t: number; latG: number; lonG: number }[];
  activeIndex?: number | null;
  onPreviewIndex?: (index: number | null) => void;
  onSeekIndex?: (index: number | null) => void;
  syncId?: string;
  compact?: boolean;
}) {
  const rowHeight = compact ? "h-[56px]" : "h-[100px] sm:h-[120px]";
  const latDomain = useMemo(() => gDomain(points, ["latG"]), [points]);
  const lonDomain = useMemo(() => gDomain(points, ["lonG"]), [points]);

  return (
    <div
      className={`w-full max-w-full space-y-1.5 overflow-hidden border border-zinc-800/80 bg-zinc-950/40 ${
        compact ? "rounded-xl px-2.5 py-2" : "rounded-2xl p-3 sm:p-4"
      }`}
    >
      <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        G-force
      </p>
      <AxisGChart
        points={points}
        dataKey="latG"
        name="Lateral G"
        stroke="#38bdf8"
        activeIndex={activeIndex}
        onPreviewIndex={onPreviewIndex}
        onSeekIndex={onSeekIndex}
        syncId={syncId}
        heightClass={rowHeight}
        domain={latDomain}
      />
      <AxisGChart
        points={points}
        dataKey="lonG"
        name="Longitudinal G"
        stroke="#f97316"
        activeIndex={activeIndex}
        onPreviewIndex={onPreviewIndex}
        onSeekIndex={onSeekIndex}
        syncId={syncId}
        heightClass={rowHeight}
        domain={lonDomain}
      />
    </div>
  );
}
