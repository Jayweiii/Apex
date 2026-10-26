"use client";

import { TrackMap } from "@/components/TrackMap";
import { COMPARE_COLORS, compareMany, hasGps } from "@/lib/compare";
import {
  comparisonSharePath,
  type ComparisonRow,
} from "@/lib/comparisons";
import { listPublicComparisons } from "@/lib/comparisons-cloud";
import { formatGap, formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { downsampleSeriesAsync } from "@/lib/telemetry-worker";
import { getTrack } from "@/lib/tracks";
import type { LapRow, TelemetryPoint } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  YAxis,
} from "recharts";

type LiveLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
  color: string;
  trackId?: string | null;
};

/** Hero-side live preview of the newest public comparison (real data only). */
export function HomeLiveExample() {
  const [row, setRow] = useState<ComparisonRow | null | undefined>(undefined);
  const [laps, setLaps] = useState<LiveLap[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<ReturnType<typeof compareMany>>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        setRow(null);
        return;
      }
      try {
        const supabase = createClient();
        const list = await listPublicComparisons(supabase, 8);
        if (cancelled) return;
        if (!list.length) {
          setRow(null);
          return;
        }

        for (const candidate of list) {
          const lapIds = candidate.items.map((item) => item.lap_id);
          const sessionIds = [
            ...new Set(candidate.items.map((item) => item.session_id)),
          ];
          const [lapsResult, sessionsResult] = await Promise.all([
            supabase
              .from("laps")
              .select("id, session_id, lap_number, lap_time_ms, telemetry")
              .in("id", lapIds),
            supabase
              .from("sessions")
              .select("id, name, track_id")
              .in("id", sessionIds),
          ]);
          if (cancelled) return;
          const lapRows = lapsResult.data;
          if (lapsResult.error || !lapRows?.length) continue;

          const byId = new Map(
            (lapRows as LapRow[]).map((lap) => [lap.id, lap]),
          );
          const sessionById = new Map(
            (sessionsResult.data ?? []).map((s) => [s.id as string, s]),
          );

          const ordered: LiveLap[] = [];
          for (let i = 0; i < candidate.items.length; i += 1) {
            const item = candidate.items[i];
            const lap = byId.get(item.lap_id);
            if (!lap) continue;
            const telemetry = (lap.telemetry ?? []) as TelemetryPoint[];
            if (!hasGps(telemetry)) continue;
            const session = sessionById.get(item.session_id);
            ordered.push({
              id: lap.id,
              lap_number: lap.lap_number,
              lap_time_ms: lap.lap_time_ms,
              telemetry,
              color: item.color || COMPARE_COLORS[i % COMPARE_COLORS.length],
              trackId: (session?.track_id as string | null) ?? null,
            });
          }

          if (ordered.length >= 2) {
            setRow(candidate);
            setLaps(ordered.slice(0, 2));
            return;
          }
        }

        setRow(null);
      } catch (err) {
        if (!cancelled) {
          setRow(null);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (laps.length < 2) {
      setSeries([]);
      return;
    }
    const full = compareMany(
      laps[0].telemetry,
      laps.slice(1).map((lap) => lap.telemetry),
    );
    // Hero delta is decorative — cap points off-main-thread when possible.
    void downsampleSeriesAsync(full, 160).then((next) => {
      if (!cancelled) setSeries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [laps]);

  if (row === undefined) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 text-sm text-zinc-500">
        Loading live example…
      </div>
    );
  }

  if (!row || laps.length < 2) {
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-6 py-8 text-center">
        <p className="text-sm text-zinc-400">No public lap comparisons yet.</p>
        <p className="max-w-xs text-xs leading-relaxed text-zinc-600">
          Upload two laps, compare them, and set the comparison to Public — it
          will show up here.
        </p>
        {error ? <p className="text-xs text-amber-200/80">{error}</p> : null}
        <Link
          href="/upload"
          className="mt-1 text-xs uppercase tracking-[0.16em] text-orange-400 hover:text-orange-300"
        >
          Upload a session
        </Link>
      </div>
    );
  }

  const trackName =
    getTrack(laps[0].trackId ?? "")?.name ?? laps[0].trackId ?? "Track";
  const gapSec = (laps[1].lap_time_ms - laps[0].lap_time_ms) / 1000;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/50">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-zinc-900/80 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Live example
          </p>
          <Link
            href={comparisonSharePath(row.id)}
            className="mt-0.5 block truncate text-sm font-medium text-zinc-100 hover:text-orange-300"
          >
            {row.title}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            {trackName} · gap {formatGap(gapSec)}
          </p>
        </div>
        <div className="space-y-0.5 text-right text-xs text-zinc-500">
          {laps.map((lap) => (
            <p key={lap.id} className="flex items-center justify-end gap-2">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: lap.color }}
              />
              <span className="font-mono text-zinc-300">
                {formatLapTime(lap.lap_time_ms)}
              </span>
            </p>
          ))}
        </div>
      </div>

      <div className="px-3 pt-3">
        <TrackMap
          compact
          hideCameraControls
          traces={laps.map((lap) => ({
            id: lap.id,
            label: `L${lap.lap_number}`,
            color: lap.color,
            points: lap.telemetry,
          }))}
        />
      </div>

      <div className="px-3 pb-3 pt-2">
        <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Delta
        </p>
        <div className="h-[88px] w-full">
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={series}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <YAxis hide domain={["auto", "auto"]} />
                <ReferenceLine y={0} stroke="#3f3f46" />
                <Line
                  type="monotone"
                  dataKey="delta1"
                  stroke={laps[1]?.color ?? "#38bdf8"}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-full items-center justify-center text-xs text-zinc-600">
              Delta unavailable
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
