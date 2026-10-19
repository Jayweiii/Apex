"use client";

import { hoverIndex } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  trimMarkers,
  onTrimBoundaryDrag,
  compact = false,
}: {
  points: { t: number; speed: number }[];
  activeIndex?: number | null;
  onHoverIndex?: (index: number | null) => void;
  syncId?: string;
  /** Lap-local time markers for start/end trim (drag when onTrimBoundaryDrag set). */
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  /** Short height for stacked telemetry columns. */
  compact?: boolean;
}) {
  const active = activeIndex != null ? points[activeIndex] : null;
  const scrub = bindChartScrub(points.length, onHoverIndex);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);

  const tAtClientX = useCallback(
    (clientX: number) => {
      const el = chartWrapRef.current;
      if (!el || points.length < 2) return null;
      const rect = el.getBoundingClientRect();
      // Account for YAxis width (~42) + margin
      const leftPad = 42;
      const rightPad = 8;
      const usable = Math.max(1, rect.width - leftPad - rightPad);
      const x = Math.min(usable, Math.max(0, clientX - rect.left - leftPad));
      const firstT = points[0].t;
      const lastT = points[points.length - 1].t;
      return firstT + (x / usable) * (lastT - firstT);
    },
    [points],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      if (!dragging || !onTrimBoundaryDrag) return;
      const t = tAtClientX(event.clientX);
      if (t == null) return;
      onTrimBoundaryDrag(dragging, t);
    },
    [dragging, onTrimBoundaryDrag, tAtClientX],
  );

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
          Speed
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          {active ? `${active.speed.toFixed(0)} km/h` : "km/h"}
          {trimMarkers && onTrimBoundaryDrag ? (
            <span className="ml-2 text-zinc-600">· drag trim</span>
          ) : null}
        </p>
      </div>
      <div
        ref={chartWrapRef}
        className={`relative touch-none ${
          compact ? "h-[88px]" : "h-[200px] sm:h-[260px]"
        }`}
        {...(dragging ? {} : scrub)}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(null)}
        onPointerLeave={() => setDragging(null)}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
            onMouseMove={(state) => {
              if (dragging) return;
              const native = (state as { event?: MouseEvent }).event;
              if (native && native.buttons === 0) return;
              onHoverIndex?.(hoverIndex(state));
            }}
            onMouseLeave={() => {
              if (!dragging) onHoverIndex?.(null);
            }}
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
            {trimMarkers ? (
              <>
                <ReferenceLine
                  x={trimMarkers.startT}
                  stroke="#38bdf8"
                  strokeWidth={2}
                />
                <ReferenceLine
                  x={trimMarkers.endT}
                  stroke="#a78bfa"
                  strokeWidth={2}
                />
              </>
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
        {trimMarkers && onTrimBoundaryDrag && points.length >= 2 ? (
          <TrimHandles
            startT={trimMarkers.startT}
            endT={trimMarkers.endT}
            firstT={points[0].t}
            lastT={points[points.length - 1].t}
            onStartDrag={() => setDragging("start")}
            onEndDrag={() => setDragging("end")}
          />
        ) : null}
      </div>
    </div>
  );
}

function TrimHandles({
  startT,
  endT,
  firstT,
  lastT,
  onStartDrag,
  onEndDrag,
}: {
  startT: number;
  endT: number;
  firstT: number;
  lastT: number;
  onStartDrag: () => void;
  onEndDrag: () => void;
}) {
  const span = Math.max(1e-6, lastT - firstT);
  // Approximate Recharts plot inset (Y-axis ~42px, right margin ~8px).
  const startFrac = (startT - firstT) / span;
  const endFrac = (endT - firstT) / span;
  return (
    <>
      <button
        type="button"
        aria-label="Drag lap start"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize bg-sky-400/20 hover:bg-sky-400/35"
        style={{
          left: `calc(42px + (100% - 50px) * ${startFrac})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          onStartDrag();
        }}
      />
      <button
        type="button"
        aria-label="Drag lap end"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize bg-violet-400/20 hover:bg-violet-400/35"
        style={{
          left: `calc(42px + (100% - 50px) * ${endFrac})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
          onEndDrag();
        }}
      />
    </>
  );
}
