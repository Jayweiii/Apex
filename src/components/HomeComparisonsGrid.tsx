"use client";

import { MiniTrackPath } from "@/components/MiniTrackPath";
import {
  comparisonSharePath,
  type ComparisonRow,
} from "@/lib/comparisons";
import { listPublicComparisons } from "@/lib/comparisons-cloud";
import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import type { LapRow, TelemetryPoint } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

type CardModel = {
  row: ComparisonRow;
  trackName: string;
  times: number[];
  pathPoints: TelemetryPoint[];
  updatedLabel: string;
};

function relativeTime(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const delta = Date.now() - ms;
  const mins = Math.floor(delta / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function HomeComparisonsGrid() {
  const [cards, setCards] = useState<CardModel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        setCards([]);
        return;
      }
      try {
        const supabase = createClient();
        const list = await listPublicComparisons(supabase, 6);
        if (cancelled) return;
        if (!list.length) {
          setCards([]);
          return;
        }

        const lapIds = [
          ...new Set(list.flatMap((row) => row.items.map((i) => i.lap_id))),
        ];
        const sessionIds = [
          ...new Set(list.flatMap((row) => row.items.map((i) => i.session_id))),
        ];
        const [{ data: lapRows }, { data: sessions }] = await Promise.all([
          supabase
            .from("laps")
            .select("id, lap_time_ms, telemetry")
            .in("id", lapIds),
          supabase.from("sessions").select("id, track_id").in("id", sessionIds),
        ]);
        if (cancelled) return;

        const lapById = new Map(
          ((lapRows ?? []) as LapRow[]).map((lap) => [lap.id, lap]),
        );
        const sessionById = new Map(
          (sessions ?? []).map((s) => [s.id as string, s]),
        );

        const next: CardModel[] = list.slice(0, 6).map((row) => {
          const times: number[] = [];
          let pathPoints: TelemetryPoint[] = [];
          let trackId: string | null = null;
          for (const item of row.items) {
            const lap = lapById.get(item.lap_id);
            if (lap) {
              times.push(lap.lap_time_ms);
              if (!pathPoints.length) {
                pathPoints = (lap.telemetry ?? []) as TelemetryPoint[];
              }
            }
            const session = sessionById.get(item.session_id);
            if (!trackId && session?.track_id) {
              trackId = session.track_id as string;
            }
          }
          return {
            row,
            trackName: getTrack(trackId ?? "")?.name ?? trackId ?? "Track",
            times,
            pathPoints,
            updatedLabel: relativeTime(row.updated_at),
          };
        });
        setCards(next);
      } catch {
        if (!cancelled) setCards([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (cards === null) {
    return <p className="text-sm text-zinc-500">Loading comparisons…</p>;
  }

  if (!cards.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-6 text-center text-sm text-zinc-500">
        No public comparisons yet.
      </p>
    );
  }

  return (
    <ul className="grid gap-3">
      {cards.map((card) => (
        <li key={card.row.id}>
          <Link
            href={comparisonSharePath(card.row.id)}
            className="block rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3 transition hover:border-zinc-600"
          >
            <MiniTrackPath points={card.pathPoints} className="h-16 w-full" />
            <p className="mt-2 truncate text-sm font-medium text-zinc-100">
              {card.row.title}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {card.trackName} · {card.row.items.length} laps
              {card.updatedLabel ? ` · ${card.updatedLabel}` : ""}
            </p>
            {card.times.length ? (
              <p className="mt-1 font-mono text-xs text-orange-400/90">
                {card.times
                  .slice(0, 2)
                  .map((ms) => formatLapTime(ms))
                  .join(" · ")}
              </p>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
