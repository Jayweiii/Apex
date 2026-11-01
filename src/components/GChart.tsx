"use client";

import { hoverIndex, isSeekPointer } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import {
  HoverCursorLine,
  PlaybackCursorLine,
  useHoverCursor,
} from "@/components/HoverCursor";
import { type PlotPad } from "@/components/hover-cursor";
import { formatG } from "@/lib/format";
import { memo, useCallback, useMemo, useRef } from "react";
import { useStableCallback } from "@/lib/use-stable-callback";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

const tooltipStyle = {
  background: "#09090b",
  border: "1px solid #27272a",
  borderRadius: 12,
  color: "#fafafa",
};

/** Plot body ≥240px so cartesian grid stays ≥200px after axis chrome. */
export const G_ROW_HEIGHT =
  "h-[240px] min-h-[240px] sm:h-[260px] sm:min-h-[260px]";

export const G_PLOT_PAD: PlotPad = { left: 40, right: 6 };

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

/**
 * The Recharts tree only. Memoized and never given the playback index, so a
 * parent re-rendering every frame does not re-render thousands of SVG nodes
 * (that pinned the main thread during playback and swallowed taps on phones).
 */
const AxisGPlot = memo(function AxisGPlot({
  points,
  dataKey,
  name,
  stroke,
  syncId,
  domain,
  sharedHover,
  onPreviewIndex,
  onSeekIndex,
}: {
  points: { t: number; latG: number; lonG: number }[];
  dataKey: "latG" | "lonG";
  name: string;
  stroke: string;
  syncId: string;
  domain: [number, number];
  sharedHover: boolean;
  onPreviewIndex: (index: number | null) => void;
  onSeekIndex: (index: number | null) => void;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
      <LineChart
        data={points}
        syncId={syncId}
        margin={{ top: 4, right: 6, left: 0, bottom: 0 }}
        onMouseMove={(state) => {
          if (sharedHover) return;
          const index = hoverIndex(state);
          if (isSeekPointer(state)) onSeekIndex(index);
          else onPreviewIndex(index);
        }}
        onMouseLeave={() => {
          if (!sharedHover) onPreviewIndex(null);
        }}
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
  );
});

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
  const hoverCursor = useHoverCursor();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const scrub = bindChartScrub(points.length, {
    onPreviewIndex: hoverCursor ? undefined : onPreviewIndex,
    onSeekIndex,
  });
  const value = active ? active[dataKey] : null;
  const previewIndex = useStableCallback(onPreviewIndex);
  const seekIndex = useStableCallback(onSeekIndex);

  const driveHover = useCallback(
    (clientX: number) => {
      const plot = plotRef.current;
      if (!plot || !hoverCursor || points.length < 1) return;
      hoverCursor.move({
        clientX,
        plotEl: plot,
        pad: G_PLOT_PAD,
        length: points.length,
      });
    },
    [hoverCursor, points.length],
  );

  return (
    <div className="min-w-0 shrink-0">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {name}
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          {value != null ? formatG(value, true) : "g"}
        </p>
      </div>
      <div
        ref={plotRef}
        className={`relative touch-none ${heightClass}`}
        data-apex-chart-plot={`g-${dataKey}`}
        {...scrub}
        onPointerMove={(event) => {
          scrub.onPointerMove?.(event);
          if ((event.buttons ?? 0) === 0) driveHover(event.clientX);
        }}
        onMouseLeave={() => {
          if (!hoverCursor) scrub.onMouseLeave?.();
        }}
      >
        <AxisGPlot
          points={points}
          dataKey={dataKey}
          name={name}
          stroke={stroke}
          syncId={syncId}
          domain={domain}
          sharedHover={hoverCursor != null}
          onPreviewIndex={previewIndex}
          onSeekIndex={seekIndex}
        />
        <PlaybackCursorLine plotRef={plotRef} pad={G_PLOT_PAD} />
        <HoverCursorLine plotRef={plotRef} pad={G_PLOT_PAD} />
      </div>
    </div>
  );
}

/** Scatter chart geometry — keep in sync with the margins/axes below. */
const FC_MARGIN = { top: 8, right: 8, left: 0, bottom: 4 };
const FC_Y_AXIS_W = 40;
const FC_X_AXIS_H = 18;

const FrictionScatter = memo(function FrictionScatter({
  points,
  domain,
}: {
  points: { t: number; latG: number; lonG: number }[];
  domain: [number, number];
}) {
  const scatter = useMemo(() => {
    const step = Math.max(1, Math.ceil(points.length / 400));
    const out: { lonG: number; latG: number }[] = [];
    for (let i = 0; i < points.length; i += step) {
      out.push({ lonG: points[i].lonG, latG: points[i].latG });
    }
    return out;
  }, [points]);

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
      <ScatterChart margin={FC_MARGIN}>
        <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
        <XAxis
          type="number"
          dataKey="lonG"
          name="Lon"
          domain={domain}
          stroke="#71717a"
          tick={{ fill: "#71717a", fontSize: 10 }}
          tickFormatter={(v: number) => v.toFixed(1)}
          height={FC_X_AXIS_H}
          allowDataOverflow
        />
        <YAxis
          type="number"
          dataKey="latG"
          name="Lat"
          domain={domain}
          stroke="#71717a"
          tick={{ fill: "#71717a", fontSize: 10 }}
          width={FC_Y_AXIS_W}
          tickFormatter={(v: number) => v.toFixed(1)}
          allowDataOverflow
        />
        <ZAxis range={[12, 12]} />
        <ReferenceLine x={0} stroke="#3f3f46" />
        <ReferenceLine y={0} stroke="#3f3f46" />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            formatG(Number(value), true),
            name === "latG" ? "Lateral" : "Longitudinal",
          ]}
        />
        <Scatter
          data={scatter}
          fill="#64748b"
          fillOpacity={0.45}
          isAnimationActive={false}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
});

function FrictionCircle({
  points,
  activeIndex,
  heightClass,
  domain,
}: {
  points: { t: number; latG: number; lonG: number }[];
  activeIndex?: number | null;
  heightClass: string;
  domain: [number, number];
}) {
  const active = activeIndex != null ? points[activeIndex] : null;
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const fx = active ? clamp01((active.lonG - lo) / span) : 0;
  const fy = active ? clamp01((active.latG - lo) / span) : 0;
  const padX = FC_MARGIN.left + FC_Y_AXIS_W;
  const padW = padX + FC_MARGIN.right;
  const padH = FC_MARGIN.top + FC_MARGIN.bottom + FC_X_AXIS_H;

  return (
    <div className="min-w-0 shrink-0">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Friction circle
        </p>
        <p className="font-mono text-[10px] text-zinc-400">
          {active
            ? `${formatG(active.latG, true)} lat · ${formatG(active.lonG, true)} lon`
            : "lat × lon"}
        </p>
      </div>
      <div
        className={`relative touch-none ${heightClass}`}
        data-apex-chart-plot="g-friction"
      >
        <FrictionScatter points={points} domain={domain} />
        {active ? (
          <span
            aria-hidden
            data-apex-friction-active="1"
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500 ring-2 ring-orange-500/30"
            style={{
              left: `calc(${padX}px + (100% - ${padW}px) * ${fx})`,
              top: `calc(${FC_MARGIN.top}px + (100% - ${padH}px) * ${1 - fy})`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Lateral + longitudinal G + friction circle — each ≥ ~120px on desktop. */
export const GChart = memo(function GChart({
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
  const rowHeight = G_ROW_HEIGHT;
  const latDomain = useMemo(() => gDomain(points, ["latG"]), [points]);
  const lonDomain = useMemo(() => gDomain(points, ["lonG"]), [points]);
  const circleDomain = useMemo(() => {
    const [latMin, latMax] = latDomain;
    const [lonMin, lonMax] = lonDomain;
    const abs = Math.max(
      Math.abs(latMin),
      Math.abs(latMax),
      Math.abs(lonMin),
      Math.abs(lonMax),
      0.5,
    );
    return [-abs, abs] as [number, number];
  }, [latDomain, lonDomain]);

  return (
    <div
      className={`w-full max-w-full shrink-0 space-y-1.5 overflow-hidden border border-zinc-800/80 bg-zinc-950/40 ${
        compact ? "rounded-xl px-2.5 py-2" : "rounded-2xl p-3 sm:p-4"
      }`}
      data-apex-g-chart
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
      <FrictionCircle
        points={points}
        activeIndex={activeIndex}
        heightClass={rowHeight}
        domain={circleDomain}
      />
    </div>
  );
});
