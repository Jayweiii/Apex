"use client";

import { hoverIndex } from "@/components/chart-hover";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { compareLaps, defaultLapPair, hasGps } from "@/lib/compare";
import { formatG, formatGap, formatLapTime } from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import type { LapRow } from "@/lib/types";
import { useMemo, useState, type ReactNode } from "react";
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

const REF_COLOR = "#f97316";
const OTHER_COLOR = "#38bdf8";

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

export function LapCompare({
  laps,
  initialRef,
  initialOther,
}: {
  laps: LapRow[];
  initialRef?: string;
  initialOther?: string;
}) {
  const defaults = defaultLapPair(laps);
  const [refId, setRefId] = useState(
    laps.some((lap) => lap.id === initialRef) ? initialRef! : defaults.ref,
  );
  const [otherId, setOtherId] = useState(
    laps.some((lap) => lap.id === initialOther) ? initialOther! : defaults.other,
  );

  const reference = laps.find((lap) => lap.id === refId) ?? laps[0];
  const other = laps.find((lap) => lap.id === otherId) ?? laps[1] ?? laps[0];
  const sameLap = reference?.id === other?.id;
  const series = useMemo(
    () =>
      reference && other && !sameLap
        ? compareLaps(reference.telemetry, other.telemetry)
        : [],
    [reference, other, sameLap],
  );
  const refPoints = useMemo(
    () => enrichTelemetry(reference?.telemetry ?? []),
    [reference],
  );
  const otherPoints = useMemo(
    () => enrichTelemetry(other?.telemetry ?? []),
    [other],
  );
  const [progress, setProgress] = useState<number | null>(null);
  const hoverAt =
    progress == null || series.length < 2
      ? null
      : Math.round(progress * (series.length - 1));

  function hoverFromChart(next: number | null) {
    if (next == null || series.length < 2) {
      setProgress(null);
      return;
    }
    setProgress(next / (series.length - 1));
  }
  const gapMs =
    reference && other ? other.lap_time_ms - reference.lap_time_ms : 0;
  const showMap =
    reference &&
    other &&
    (hasGps(reference.telemetry) || hasGps(other.telemetry));

  if (laps.length < 2) {
    return (
      <p className="text-sm text-zinc-500">
        This session needs at least two laps to compare.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <LapSelect
          label="Reference"
          value={reference?.id ?? ""}
          laps={laps}
          onChange={setRefId}
        />
        <LapSelect
          label="Compared lap"
          value={other?.id ?? ""}
          laps={laps}
          onChange={setOtherId}
        />
      </div>

      {sameLap ? (
        <p className="text-sm text-zinc-500">Pick two different laps.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                Lap time gap
              </p>
              <p className="mt-1 font-mono text-3xl text-zinc-50">
                {formatGap(gapMs / 1000)}
              </p>
            </div>
            <div className="text-sm text-zinc-400">
              <p>
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-orange-500" />
                Lap {reference.lap_number}{" "}
                <span className="font-mono text-zinc-200">
                  {formatLapTime(reference.lap_time_ms)}
                </span>
              </p>
              <p className="mt-1">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-400" />
                Lap {other.lap_number}{" "}
                <span className="font-mono text-zinc-200">
                  {formatLapTime(other.lap_time_ms)}
                </span>
              </p>
            </div>
          </div>

          {showMap ? (
            <TrackMap
              traces={[
                {
                  id: reference.id,
                  label: `Lap ${reference.lap_number}`,
                  color: REF_COLOR,
                  points: refPoints,
                },
                {
                  id: other.id,
                  label: `Lap ${other.lap_number}`,
                  color: OTHER_COLOR,
                  points: otherPoints,
                },
              ]}
              activeProgress={progress}
              onProgress={setProgress}
            />
          ) : (
            <MissingGps />
          )}

          <ChartCard title="Speed" hint="Aligned along each lap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => hoverFromChart(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={formatDistance}
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                  width={42}
                  tickFormatter={(value: number) => `${Math.round(value)}`}
                />
                <Tooltip cursor={false} content={<CompareTooltip />} />
                {hoverAt != null ? (
                  <ReferenceLine x={series[hoverAt].dist} stroke="#e4e4e7" strokeDasharray="3 3" />
                ) : null}
                <Legend />
                <Line
                  type="monotone"
                  dataKey="refSpeed"
                  name={`Lap ${reference.lap_number}`}
                  stroke={REF_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="otherSpeed"
                  name={`Lap ${other.lap_number}`}
                  stroke={OTHER_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Time gap"
            hint="Above zero means the compared lap is behind the reference"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => hoverFromChart(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={formatDistance}
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                  width={48}
                  tickFormatter={(value: number) => `${value.toFixed(1)}s`}
                />
                <ReferenceLine y={0} stroke="#52525b" />
                {hoverAt != null ? (
                  <ReferenceLine x={series[hoverAt].dist} stroke="#e4e4e7" strokeDasharray="3 3" />
                ) : null}
                <Tooltip cursor={false} content={<CompareTooltip mode="delta" />} />
                <Line
                  type="monotone"
                  dataKey="delta"
                  name="Gap"
                  stroke="#e4e4e7"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="G" hint="Combined acceleration for each lap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => hoverFromChart(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={formatDistance}
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fill: "#71717a", fontSize: 12 }}
                  width={42}
                  tickFormatter={(value: number) => value.toFixed(1)}
                />
                {hoverAt != null ? (
                  <ReferenceLine x={series[hoverAt].dist} stroke="#e4e4e7" strokeDasharray="3 3" />
                ) : null}
                <Tooltip cursor={false} content={<CompareTooltip mode="g" />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="refG"
                  name={`Lap ${reference.lap_number}`}
                  stroke={REF_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="otherG"
                  name={`Lap ${other.lap_number}`}
                  stroke={OTHER_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  );
}

function LapSelect({
  label,
  value,
  laps,
  onChange,
}: {
  label: string;
  value: string;
  laps: LapRow[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
      >
        {laps.map((lap) => (
          <option key={lap.id} value={lap.id}>
            Lap {lap.lap_number} · {formatLapTime(lap.lap_time_ms)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChartCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="h-[340px] rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{title}</p>
        <p className="text-xs text-zinc-600">{hint}</p>
      </div>
      <div className="h-[280px]">{children}</div>
    </div>
  );
}

function CompareTooltip({
  active,
  payload,
  label,
  mode = "speed",
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: number;
  mode?: "speed" | "delta" | "g";
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-100">
      <p className="mb-1 text-zinc-500">{formatDistance(Number(label))}</p>
      {payload.map((item) => (
        <p key={item.name} style={{ color: item.color }}>
          {item.name}:{" "}
          {mode === "delta"
            ? formatGap(Number(item.value))
            : mode === "g"
              ? formatG(Number(item.value))
              : `${Number(item.value).toFixed(0)} km/h`}
        </p>
      ))}
    </div>
  );
}
