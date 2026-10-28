"use client";

import {
  comparisonSharePath,
  type ComparisonRow,
} from "@/lib/comparisons";
import { listPublicComparisons } from "@/lib/comparisons-cloud";
import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useState } from "react";

type EnrichedComparison = ComparisonRow & {
  trackName?: string | null;
  lapTimes?: Array<number | null>;
};

export function DiscoverComparisons() {
  const [rows, setRows] = useState<EnrichedComparison[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setRows([]);
      setError("Supabase is not configured.");
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    listPublicComparisons(supabase)
      .then(async (list) => {
        if (cancelled) return;
        // Enrich cards with track + lap times (same shape as home).
        const lapIds = [
          ...new Set(list.flatMap((row) => row.items.map((item) => item.lap_id))),
        ];
        const sessionIds = [
          ...new Set(
            list.flatMap((row) => row.items.map((item) => item.session_id)),
          ),
        ];
        const lapTimeById = new Map<string, number>();
        const trackBySession = new Map<string, string | null>();
        if (lapIds.length) {
          const { data: laps } = await supabase
            .from("laps")
            .select("id, lap_time_ms")
            .in("id", lapIds.slice(0, 120));
          for (const lap of laps ?? []) {
            lapTimeById.set(lap.id as string, lap.lap_time_ms as number);
          }
        }
        if (sessionIds.length) {
          const { data: sessions } = await supabase
            .from("sessions")
            .select("id, track_id")
            .in("id", sessionIds.slice(0, 80));
          for (const session of sessions ?? []) {
            trackBySession.set(
              session.id as string,
              (session.track_id as string | null) ?? null,
            );
          }
        }
        if (cancelled) return;
        setRows(
          list.map((row) => {
            const trackId =
              row.items
                .map((item) => trackBySession.get(item.session_id))
                .find((id) => id) ?? null;
            const track = trackId ? getTrack(trackId) : null;
            return {
              ...row,
              trackName: track?.name ?? trackId,
              lapTimes: row.items.map(
                (item) => lapTimeById.get(item.lap_id) ?? null,
              ),
            };
          }),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows == null) {
    return <p className="text-sm text-zinc-500">Loading public comparisons…</p>;
  }

  if (error && /comparisons.*does not exist|Could not find the table/i.test(error)) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
        Apply{" "}
        <code className="text-zinc-300">
          supabase/migrations/20261019_comparisons.sql
        </code>{" "}
        in the Supabase SQL editor to enable Lap Comparisons.
      </p>
    );
  }

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
        No public comparisons yet. Save one from a compare view and set
        visibility to Public.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => {
        const times = (row.lapTimes ?? [])
          .filter((ms): ms is number => ms != null && Number.isFinite(ms))
          .slice(0, 4)
          .map((ms) => formatLapTime(ms));
        return (
          <li key={row.id}>
            <Link
              href={comparisonSharePath(row.id)}
              className="block rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-4 transition hover:border-zinc-600"
            >
              <p className="text-sm font-medium text-zinc-100">{row.title}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {row.trackName ?? "Track"}
                {" · "}
                {row.items.length} laps
                {row.description ? ` · ${row.description.slice(0, 60)}` : ""}
              </p>
              {times.length ? (
                <p className="mt-2 font-mono text-sm text-orange-400">
                  {times.join(" · ")}
                </p>
              ) : null}
            </Link>
          </li>
        );
      })}
      {error ? (
        <li className="sm:col-span-2 text-sm text-amber-200">{error}</li>
      ) : null}
    </ul>
  );
}
