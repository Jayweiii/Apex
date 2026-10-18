"use client";

import { hoverIndex } from "@/components/chart-hover";
import { bindChartScrub } from "@/components/chart-scrub";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { MissingGps, TrackMap } from "@/components/TrackMap";
import { useAnalysisMode } from "@/lib/analysis-mode";
import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import { compareLaps, defaultLapPair, hasGps } from "@/lib/compare";
import {
  type CompareSessionOption,
} from "@/lib/compare-sessions";
import { formatG, formatGap, formatLapTime } from "@/lib/format";
import { enrichTelemetry } from "@/lib/gforce";
import {
  analysisPoints,
  displayPoints,
  mapMatchLap,
  type GpsDisplayMode,
} from "@/lib/map-match";
import { progressFromIndex } from "@/lib/scrub";
import { getTrack } from "@/lib/tracks";
import type { LapRow } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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

export type { CompareSessionOption };

const REF_COLOR = "#f97316";
const OTHER_COLOR = "#38bdf8";

function formatDistance(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters)} m`;
}

function findSessionForLap(
  sessions: CompareSessionOption[],
  lapId: string | undefined,
) {
  if (!lapId) return sessions[0] ?? null;
  return sessions.find((session) => session.laps.some((lap) => lap.id === lapId)) ?? null;
}

export function LapCompare({
  laps,
  sessions,
  initialRef,
  initialOther,
  initialOtherSession,
  initialTrackId,
}: {
  laps: LapRow[];
  /** Sessions available for cross-session compare (own / friends / public / local). */
  sessions?: CompareSessionOption[];
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
  /** Prefer filtering pickers to this track when multiple tracks are present. */
  initialTrackId?: string;
}) {
  const allSessions = useMemo<CompareSessionOption[]>(() => {
    if (sessions?.length) return sessions;
    return [
      {
        id: laps[0]?.session_id ?? "current",
        name: "This session",
        laps,
      },
    ];
  }, [sessions, laps]);

  const trackOptions = useMemo(() => {
    const ids = [
      ...new Set(
        allSessions
          .map((session) => session.trackId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    return ids;
  }, [allSessions]);

  const [trackFilter, setTrackFilter] = useState(() => {
    if (initialTrackId && trackOptions.includes(initialTrackId)) {
      return initialTrackId;
    }
    return trackOptions[0] ?? "";
  });

  useEffect(() => {
    if (!trackOptions.length) {
      setTrackFilter("");
      return;
    }
    if (trackFilter && trackOptions.includes(trackFilter)) return;
    if (initialTrackId && trackOptions.includes(initialTrackId)) {
      setTrackFilter(initialTrackId);
      return;
    }
    setTrackFilter(trackOptions[0] ?? "");
  }, [trackOptions, trackFilter, initialTrackId]);

  const filteredSessions = useMemo(() => {
    if (!trackFilter) return allSessions;
    const matched = allSessions.filter(
      (session) => !session.trackId || session.trackId === trackFilter,
    );
    return matched.length ? matched : allSessions;
  }, [allSessions, trackFilter]);

  const [refSessionId, setRefSessionId] = useState(
    () =>
      findSessionForLap(filteredSessions, initialRef)?.id ??
      filteredSessions[0]?.id ??
      "",
  );
  const [otherSessionId, setOtherSessionId] = useState(() => {
    if (
      initialOtherSession &&
      filteredSessions.some((s) => s.id === initialOtherSession)
    ) {
      return initialOtherSession;
    }
    const fromOther = findSessionForLap(filteredSessions, initialOther);
    if (fromOther) return fromOther.id;
    const otherPeer = filteredSessions.find(
      (session) =>
        session.id !== filteredSessions[0]?.id &&
        (session.kind === "upload" ||
          session.kind === "friends" ||
          session.kind === "public"),
    );
    return (
      otherPeer?.id ??
      filteredSessions[1]?.id ??
      filteredSessions[0]?.id ??
      ""
    );
  });

  useEffect(() => {
    if (!filteredSessions.some((session) => session.id === refSessionId)) {
      setRefSessionId(filteredSessions[0]?.id ?? "");
    }
    if (!filteredSessions.some((session) => session.id === otherSessionId)) {
      const peer =
        filteredSessions.find((session) => session.id !== refSessionId) ??
        filteredSessions[0];
      setOtherSessionId(peer?.id ?? "");
    }
  }, [filteredSessions, refSessionId, otherSessionId]);

  const refSession =
    filteredSessions.find((session) => session.id === refSessionId) ??
    filteredSessions[0];
  const otherSession =
    filteredSessions.find((session) => session.id === otherSessionId) ??
    filteredSessions[1] ??
    filteredSessions[0];

  const [refId, setRefId] = useState(() => {
    if (initialRef && refSession?.laps.some((lap) => lap.id === initialRef)) {
      return initialRef;
    }
    return defaultLapPair(refSession?.laps ?? []).ref;
  });
  const [otherId, setOtherId] = useState(() => {
    if (initialOther && otherSession?.laps.some((lap) => lap.id === initialOther)) {
      return initialOther;
    }
    const pair = defaultLapPair(otherSession?.laps ?? []);
    if (otherSession?.id === refSession?.id) return pair.other || pair.ref;
    return pair.ref;
  });

  useEffect(() => {
    if (!refSession?.laps.some((lap) => lap.id === refId)) {
      setRefId(defaultLapPair(refSession?.laps ?? []).ref);
    }
  }, [refSession, refId]);

  useEffect(() => {
    if (!otherSession?.laps.some((lap) => lap.id === otherId)) {
      const pair = defaultLapPair(otherSession?.laps ?? []);
      setOtherId(
        otherSession?.id === refSession?.id ? pair.other || pair.ref : pair.ref,
      );
    }
  }, [otherSession, otherId, refSession?.id]);

  const reference =
    refSession?.laps.find((lap) => lap.id === refId) ?? refSession?.laps[0];
  const other =
    otherSession?.laps.find((lap) => lap.id === otherId) ??
    otherSession?.laps[0] ??
    reference;
  const sameLap = reference?.id === other?.id;

  const centerline = useMemo(() => {
    const sampleLaps = [
      ...(reference?.telemetry ? [reference.telemetry] : []),
      ...(other?.telemetry && other.id !== reference?.id
        ? [other.telemetry]
        : []),
      ...(refSession?.laps.map((lap) => lap.telemetry) ?? []),
    ];
    return resolveTrackCenterline(trackFilter || undefined, null, sampleLaps);
  }, [trackFilter, reference, other, refSession]);

  const refMatched = useMemo(
    () =>
      reference ? mapMatchLap(reference.telemetry, centerline) : null,
    [reference, centerline],
  );
  const otherMatched = useMemo(
    () => (other ? mapMatchLap(other.telemetry, centerline) : null),
    [other, centerline],
  );

  const [gpsMode, setGpsMode] = useState<GpsDisplayMode>("snapped");
  const {
    mode: analysisMode,
    setMode: setAnalysisMode,
    hasSnap: hasAnalysisSnap,
  } = useAnalysisMode(Boolean(centerline));

  const series = useMemo(
    () =>
      reference && other && !sameLap
        ? compareLaps(
            analysisPoints(refMatched, reference.telemetry, analysisMode),
            analysisPoints(otherMatched, other.telemetry, analysisMode),
          )
        : [],
    [reference, other, sameLap, refMatched, otherMatched, analysisMode],
  );
  const refPoints = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(
          refMatched,
          reference?.telemetry ?? [],
          centerline ? gpsMode : "raw",
        ),
      ),
    [reference, refMatched, gpsMode, centerline],
  );
  const otherPoints = useMemo(
    () =>
      enrichTelemetry(
        displayPoints(
          otherMatched,
          other?.telemetry ?? [],
          centerline ? gpsMode : "raw",
        ),
      ),
    [other, otherMatched, gpsMode, centerline],
  );
  const [progress, setProgress] = useState<number | null>(null);
  const hoverAt =
    progress == null || series.length < 2
      ? null
      : Math.round(progress * (series.length - 1));

  const hoverFromChart = useCallback(
    (next: number | null) => {
      setProgress(progressFromIndex(next, series.length));
    },
    [series.length],
  );
  const chartScrub = bindChartScrub(series.length, hoverFromChart);
  const gapMs =
    reference && other ? other.lap_time_ms - reference.lap_time_ms : 0;
  const showMap =
    reference &&
    other &&
    (hasGps(reference.telemetry) || hasGps(other.telemetry));
  const multiSession = filteredSessions.length > 1;
  const totalLaps = filteredSessions.reduce(
    (sum, session) => sum + session.laps.length,
    0,
  );

  if (totalLaps < 2) {
    return (
      <p className="text-sm text-zinc-500">
        Need at least two laps to compare. Upload another session, open a
        friends/public session on this track, or pick a demo lap.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {trackOptions.length > 1 ? (
        <label className="flex max-w-md flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">Track filter</span>
          <select
            value={trackFilter}
            onChange={(event) => setTrackFilter(event.target.value)}
            className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
          >
            {trackOptions.map((trackId) => (
              <option key={trackId} value={trackId}>
                {getTrack(trackId)?.name ?? trackId}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-3">
          {multiSession ? (
            <SessionSelect
              label="Reference session"
              value={refSession?.id ?? ""}
              sessions={filteredSessions}
              onChange={(id) => {
                setRefSessionId(id);
                const next = filteredSessions.find((session) => session.id === id);
                setRefId(defaultLapPair(next?.laps ?? []).ref);
              }}
            />
          ) : null}
          <LapSelect
            label="Reference lap"
            value={reference?.id ?? ""}
            laps={refSession?.laps ?? []}
            onChange={setRefId}
          />
        </div>
        <div className="grid gap-3">
          {multiSession ? (
            <SessionSelect
              label="Compared session"
              value={otherSession?.id ?? ""}
              sessions={filteredSessions}
              onChange={(id) => {
                setOtherSessionId(id);
                const next = filteredSessions.find((session) => session.id === id);
                const pair = defaultLapPair(next?.laps ?? []);
                setOtherId(id === refSessionId ? pair.other || pair.ref : pair.ref);
              }}
            />
          ) : null}
          <LapSelect
            label="Compared lap"
            value={other?.id ?? ""}
            laps={otherSession?.laps ?? []}
            onChange={setOtherId}
          />
        </div>
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
              <p className="flex flex-wrap items-center gap-2">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-orange-500" />
                {refSession && refSession.name !== "This session"
                  ? `${refSession.name} · `
                  : ""}
                Lap {reference?.lap_number}{" "}
                <span className="font-mono text-zinc-200">
                  {formatLapTime(reference?.lap_time_ms ?? 0)}
                </span>
                <GpsQualityBadge
                  quality={refSession?.gpsQuality}
                  sourceKind={refSession?.sourceKind}
                />
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-2">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-sky-400" />
                {otherSession && otherSession.name !== "This session"
                  ? `${otherSession.name} · `
                  : ""}
                Lap {other?.lap_number}{" "}
                <span className="font-mono text-zinc-200">
                  {formatLapTime(other?.lap_time_ms ?? 0)}
                </span>
                <GpsQualityBadge
                  quality={otherSession?.gpsQuality}
                  sourceKind={otherSession?.sourceKind}
                />
              </p>
            </div>
          </div>

          {showMap && reference && other ? (
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
              centerline={centerline}
              gpsMode={centerline ? gpsMode : undefined}
              onGpsModeChange={centerline ? setGpsMode : undefined}
              analysisMode={centerline ? analysisMode : undefined}
              onAnalysisModeChange={centerline ? setAnalysisMode : undefined}
              analysisDisabled={!hasAnalysisSnap}
            />
          ) : (
            <MissingGps />
          )}

          <ChartCard
            title="Speed"
            hint={
              analysisMode === "snapped"
                ? "Aligned on snapped track distance"
                : "Aligned on raw GPS path"
            }
            scrub={chartScrub}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => setProgress(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={(value) => formatDistance(Number(value))}
                  stroke="#71717a"
                  fontSize={11}
                />
                <YAxis stroke="#71717a" fontSize={11} unit=" km/h" width={48} />
                <Tooltip content={<CompareTooltip />} />
                <Legend />
                {hoverAt != null ? (
                  <ReferenceLine
                    x={series[hoverAt]?.dist}
                    stroke="#a1a1aa"
                    strokeDasharray="4 4"
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="refSpeed"
                  name={`Lap ${reference?.lap_number}`}
                  stroke={REF_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="otherSpeed"
                  name={`Lap ${other?.lap_number}`}
                  stroke={OTHER_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Delta"
            hint={
              analysisMode === "snapped"
                ? "Snapped · positive means compared lap is behind"
                : "Raw · positive means compared lap is behind"
            }
            scrub={chartScrub}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => setProgress(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={(value) => formatDistance(Number(value))}
                  stroke="#71717a"
                  fontSize={11}
                />
                <YAxis stroke="#71717a" fontSize={11} unit=" s" width={48} />
                <Tooltip content={<CompareTooltip mode="delta" />} />
                {hoverAt != null ? (
                  <ReferenceLine
                    x={series[hoverAt]?.dist}
                    stroke="#a1a1aa"
                    strokeDasharray="4 4"
                  />
                ) : null}
                <ReferenceLine y={0} stroke="#52525b" />
                <Line
                  type="monotone"
                  dataKey="delta"
                  name="Gap"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="G" hint="Combined acceleration" scrub={chartScrub}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                syncId="compare"
                margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
                onMouseMove={(state) => hoverFromChart(hoverIndex(state))}
                onMouseLeave={() => setProgress(null)}
              >
                <CartesianGrid stroke="#27272a" strokeDasharray="3 6" />
                <XAxis
                  dataKey="dist"
                  type="number"
                  tickFormatter={(value) => formatDistance(Number(value))}
                  stroke="#71717a"
                  fontSize={11}
                />
                <YAxis stroke="#71717a" fontSize={11} width={40} />
                <Tooltip content={<CompareTooltip mode="g" />} />
                <Legend />
                {hoverAt != null ? (
                  <ReferenceLine
                    x={series[hoverAt]?.dist}
                    stroke="#a1a1aa"
                    strokeDasharray="4 4"
                  />
                ) : null}
                <Line
                  type="monotone"
                  dataKey="refG"
                  name={`Lap ${reference?.lap_number}`}
                  stroke={REF_COLOR}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="otherG"
                  name={`Lap ${other?.lap_number}`}
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

function SessionSelect({
  label,
  value,
  sessions,
  onChange,
}: {
  label: string;
  value: string;
  sessions: CompareSessionOption[];
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
      >
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.name}
            {session.sourceKind === "gopro" || session.gpsQuality?.rank
              ? session.gpsQuality?.stream
                ? ` · ${session.gpsQuality.stream}`
                : " · GoPro"
              : ""}
            {session.kind === "upload" ? " · you" : ""}
            {session.kind === "friends" ? " · friends" : ""}
            {session.kind === "demo" ? " · demo" : ""}
            {session.kind === "public" ? " · public" : ""}
          </option>
        ))}
      </select>
    </label>
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
        className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
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
  scrub,
}: {
  title: string;
  hint: string;
  children: ReactNode;
  scrub?: ReturnType<typeof bindChartScrub>;
}) {
  return (
    <div className="h-[260px] max-w-full overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:h-[340px] sm:p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">{title}</p>
        <p className="hidden text-xs text-zinc-600 sm:block">{hint}</p>
      </div>
      <div className="h-[200px] touch-none sm:h-[280px]" {...scrub}>
        {children}
      </div>
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
