"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import { HoverCursorLine, useHoverCursor } from "@/components/HoverCursor";
import { type PlotPad } from "@/components/hover-cursor";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import {
  STACKED_SPEED_MIN_HEIGHT,
  STACKED_SPEED_MIN_HEIGHT_SM,
} from "@/lib/chart-height-contract";
import { formatSpeed, kmhToDisplay, speedUnitSuffix } from "@/lib/format";
import { chartTAtClientX } from "@/lib/lap-trim";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Plot pad matches YAxis width + right margin (hover line + scrub). */
export const SPEED_PLOT_PAD: PlotPad = { left: 48, right: 8 };

export { chartTAtClientX } from "@/lib/lap-trim";

const tooltipStyle = {
  background: "#09090b",
  border: "1px solid #27272a",
  borderRadius: 12,
  color: "#fafafa",
};

/** Auto-scale speed axis to data min–max with padding (readable ticks). */
export function speedAxisDomain(
  points: { speed: number }[],
  padFrac = 0.08,
): [number, number] {
  if (!points.length) return [0, 100];
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    // Ignore non-physical speeds so a corrupt source_gps hydrate cannot
    // collapse the axis to an empty-looking domain.
    if (!Number.isFinite(point.speed)) continue;
    if (point.speed < -2 || point.speed > 400) continue;
    if (point.speed < min) min = point.speed;
    if (point.speed > max) max = point.speed;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 100];
  if (max - min < 1) {
    min = Math.max(0, min - 5);
    max = max + 5;
  }
  const pad = Math.max(2, (max - min) * padFrac);
  return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
}

export type SpeedChartPoint = {
  t: number;
  speed: number;
  /** Neighbor padding — drawn grey. Defaults true when omitted. */
  inLap?: boolean;
  /** Orange overlay for the effective trim window. */
  speedInTrim?: number | null;
};

export function SpeedChart({
  points,
  activeIndex = null,
  onPreviewIndex,
  onSeekIndex,
  syncId = "lap",
  trimMarkers,
  onTrimBoundaryDrag,
  compact = false,
  fill = false,
}: {
  points: SpeedChartPoint[];
  activeIndex?: number | null;
  onPreviewIndex?: (index: number | null) => void;
  onSeekIndex?: (index: number | null) => void;
  syncId?: string;
  trimMarkers?: { startT: number; endT: number };
  onTrimBoundaryDrag?: (which: "start" | "end", lapLocalT: number) => void;
  compact?: boolean;
  /** Grow to fill flex parent (speed hero ~40% of stacked panel). */
  fill?: boolean;
}) {
  const [speedUnit] = useSpeedUnit();
  const active = activeIndex != null ? points[activeIndex] : null;
  const hoverCursor = useHoverCursor();
  const scrub = bindChartScrub(points.length, {
    // Hover preview is owned by HoverCursorScope (pointer-x + rAF).
    // Only forward preview when no shared cursor (standalone chart).
    onPreviewIndex: hoverCursor ? undefined : onPreviewIndex,
    onSeekIndex,
  });
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const displayPoints = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        speed: kmhToDisplay(point.speed, speedUnit),
        speedInTrim:
          point.speedInTrim == null
            ? point.speedInTrim
            : kmhToDisplay(point.speedInTrim, speedUnit),
      })),
    [points, speedUnit],
  );
  const domain = useMemo(() => speedAxisDomain(displayPoints), [displayPoints]);
  const unitLabel = speedUnitSuffix(speedUnit);

  const driveHover = useCallback(
    (clientX: number) => {
      const plot = chartWrapRef.current;
      if (!plot || points.length < 1) return;
      if (hoverCursor) {
        hoverCursor.move({
          clientX,
          plotEl: plot,
          pad: SPEED_PLOT_PAD,
          length: points.length,
        });
        return;
      }
      // Standalone fallback: parent still gets index via scrub/Recharts.
    },
    [hoverCursor, points.length],
  );
  const hasPad = points.some((p) => p.inLap === false);
  const hasTrimOverlay = points.some((p) => p.speedInTrim != null);

  // Explicit px heights — `h-full`/`flex-1` inside a min-height-only flex
  // parent collapses ResponsiveContainer to 0×0 (empty speed chart on prod).
  // Class strings must be static so Tailwind JIT keeps them.
  const bodyHeight = fill
    ? "h-[124px] min-h-[124px] sm:h-[160px] sm:min-h-[160px]"
    : compact
      ? "h-[100px] min-h-[100px] sm:h-[120px]"
      : "h-[200px] sm:h-[260px]";

  const tAtClientX = useCallback(
    (clientX: number) => {
      const el = chartWrapRef.current;
      if (!el || points.length < 2) return null;
      const rect = el.getBoundingClientRect();
      return chartTAtClientX(
        clientX,
        rect,
        points[0].t,
        points[points.length - 1].t,
      );
    },
    [points],
  );

  // Window-level move/up so dragging works off the chart edge (pointer capture).
  useEffect(() => {
    if (!dragging || !onTrimBoundaryDrag) return;
    function onMove(event: PointerEvent) {
      const t = tAtClientX(event.clientX);
      if (t == null) return;
      onTrimBoundaryDrag?.(dragging!, t);
    }
    function onUp() {
      setDragging(null);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onTrimBoundaryDrag, tAtClientX]);

  const firstT = points[0]?.t ?? 0;
  const lastT = points[points.length - 1]?.t ?? 1;

  // Keep literal classes in sync with STACKED_SPEED_MIN_HEIGHT / _SM (160 / 200).
  if (
    process.env.NODE_ENV !== "production" &&
    (STACKED_SPEED_MIN_HEIGHT !== 160 || STACKED_SPEED_MIN_HEIGHT_SM !== 200)
  ) {
    throw new Error("SpeedChart fill heights drifted from chart-height-contract");
  }
  const fillShell = fill
    ? "h-[160px] min-h-[160px] sm:h-[200px] sm:min-h-[200px]"
    : "";

  return (
    <div
      className={`flex w-full max-w-full flex-col overflow-hidden border border-zinc-800/80 bg-zinc-950/40 ${
        compact
          ? "rounded-xl px-2.5 py-2"
          : "h-[260px] rounded-2xl p-3 sm:h-[320px] sm:p-4"
      } ${fillShell}`}
    >
      <div className="mb-1 flex shrink-0 items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Speed
        </p>
        <p className="font-mono text-[10px] text-zinc-400" data-apex-speed-unit-label={speedUnit}>
          {active ? formatSpeed(active.speed, speedUnit) : unitLabel}
          {trimMarkers && onTrimBoundaryDrag ? (
            <span className="ml-2 text-zinc-600">· drag trim</span>
          ) : null}
        </p>
      </div>
      <div
        ref={chartWrapRef}
        className={`relative min-h-0 flex-1 touch-none ${bodyHeight}`}
        data-apex-chart-plot="speed"
        {...(dragging ? {} : scrub)}
        onPointerMove={(event) => {
          if (dragging) return;
          scrub.onPointerMove?.(event);
          if ((event.buttons ?? 0) === 0) driveHover(event.clientX);
        }}
        onPointerLeave={() => {
          // Do not clear trim dragging here — window listeners + pointer capture
          // keep the drag alive off the chart edge.
          // Stack HoverCursorScope clears hover; standalone still clears.
          if (!dragging && !hoverCursor) scrub.onMouseLeave?.();
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={displayPoints}
            syncId={syncId}
            margin={{ top: 8, right: 8, left: 0, bottom: 4 }}
            onMouseMove={(state) => {
              if (dragging || hoverCursor) return;
              const index = hoverIndex(state);
              if (isSeekPointer(state)) onSeekIndex?.(index);
              else onPreviewIndex?.(index);
            }}
            onMouseLeave={() => {
              if (!dragging && !hoverCursor) onPreviewIndex?.(null);
            }}
          >
            <defs>
              <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="speedFillDim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#71717a" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#71717a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
            <XAxis
              dataKey="t"
              type="number"
              tickFormatter={(value: number) => `${value.toFixed(0)}s`}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 11 }}
              height={18}
            />
            <YAxis
              dataKey="speed"
              domain={domain}
              stroke="#71717a"
              tick={{ fill: "#71717a", fontSize: 11 }}
              tickFormatter={(value: number) => `${Math.round(value)}`}
              width={48}
              allowDataOverflow
            />
            <Tooltip
              cursor={false}
              contentStyle={tooltipStyle}
              formatter={(value) => [
                `${Number(value).toFixed(1)} ${unitLabel}`,
                "Speed",
              ]}
              labelFormatter={(label) => `${Number(label).toFixed(1)}s`}
            />
            {hasPad && trimMarkers ? (
              <>
                {trimMarkers.startT > firstT + 0.01 ? (
                  <ReferenceArea
                    x1={firstT}
                    x2={trimMarkers.startT}
                    fill="#3f3f46"
                    fillOpacity={0.35}
                    strokeOpacity={0}
                  />
                ) : null}
                {trimMarkers.endT < lastT - 0.01 ? (
                  <ReferenceArea
                    x1={trimMarkers.endT}
                    x2={lastT}
                    fill="#3f3f46"
                    fillOpacity={0.35}
                    strokeOpacity={0}
                  />
                ) : null}
              </>
            ) : null}
            {/* Playback cursor — solid. Hover is a separate dashed DOM line. */}
            {active ? (
              <ReferenceLine
                x={active.t}
                stroke="#e4e4e7"
                strokeWidth={1.5}
              />
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
              stroke={hasPad || hasTrimOverlay ? "#71717a" : "#f97316"}
              strokeWidth={hasPad || hasTrimOverlay ? 1.5 : 2}
              fill={
                hasPad || hasTrimOverlay ? "url(#speedFillDim)" : "url(#speedFill)"
              }
              dot={false}
              isAnimationActive={false}
            />
            {hasTrimOverlay ? (
              <Area
                type="monotone"
                dataKey="speedInTrim"
                stroke="#f97316"
                strokeWidth={2}
                fill="url(#speedFill)"
                connectNulls={false}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
          </AreaChart>
        </ResponsiveContainer>
        <HoverCursorLine plotRef={chartWrapRef} pad={SPEED_PLOT_PAD} />
        {trimMarkers && onTrimBoundaryDrag && points.length >= 2 ? (
          <TrimHandles
            startT={trimMarkers.startT}
            endT={trimMarkers.endT}
            firstT={points[0].t}
            lastT={points[points.length - 1].t}
            onStartDrag={(event) => {
              (event.currentTarget as HTMLElement).setPointerCapture?.(
                event.pointerId,
              );
              setDragging("start");
            }}
            onEndDrag={(event) => {
              (event.currentTarget as HTMLElement).setPointerCapture?.(
                event.pointerId,
              );
              setDragging("end");
            }}
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
  onStartDrag: (event: React.PointerEvent) => void;
  onEndDrag: (event: React.PointerEvent) => void;
}) {
  const span = Math.max(1e-6, lastT - firstT);
  const startFrac = (startT - firstT) / span;
  const endFrac = (endT - firstT) / span;
  return (
    <>
      <button
        type="button"
        aria-label="Drag lap start"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize bg-sky-400/20 hover:bg-sky-400/35"
        style={{
          left: `calc(48px + (100% - 56px) * ${startFrac})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStartDrag(event);
        }}
      />
      <button
        type="button"
        aria-label="Drag lap end"
        className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize bg-violet-400/20 hover:bg-violet-400/35"
        style={{
          left: `calc(48px + (100% - 56px) * ${endFrac})`,
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onEndDrag(event);
        }}
      />
    </>
  );
}
