"use client";

import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useState } from "react";

type PublicRow = {
  id: string;
  name: string;
  track_id?: string | null;
  car?: string | null;
  driver_name?: string | null;
  created_at: string;
  bestMs?: number;
};

/**
 * Cloud sessions with visibility=public — visible signed-out once the
 * visibility RLS migration is applied.
 */
export function PublicCloudSessions() {
  const [rows, setRows] = useState<PublicRow[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) setRows([]);
        return;
      }
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("sessions")
          .select("id, name, track_id, car, driver_name, created_at")
          .eq("visibility", "public")
          .order("created_at", { ascending: false })
          .limit(20);
        if (cancelled) return;
        if (error) {
          // Column / RLS not migrated yet — hide section quietly.
          if (/visibility/i.test(error.message)) {
            setUnavailable(true);
            setRows([]);
            return;
          }
          setRows([]);
          return;
        }
        const list = (data ?? []) as PublicRow[];
        const ids = list.map((row) => row.id);
        const bestBySession = new Map<string, number>();
        if (ids.length) {
          const { data: laps } = await supabase
            .from("laps")
            .select("session_id, lap_time_ms")
            .in("session_id", ids);
          for (const lap of laps ?? []) {
            const current = bestBySession.get(lap.session_id);
            if (current == null || lap.lap_time_ms < current) {
              bestBySession.set(lap.session_id, lap.lap_time_ms);
            }
          }
        }
        if (!cancelled) {
          setRows(
            list.map((row) => ({
              ...row,
              bestMs: bestBySession.get(row.id),
            })),
          );
        }
      } catch {
        if (!cancelled) setRows([]);
      }
    }
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  if (unavailable || rows === null) {
    if (rows === null) {
      return null;
    }
    return null;
  }
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-zinc-200">Public sessions</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Shared by Apex drivers with a public link.
        </p>
      </div>
      <ul className="grid gap-3">
        {rows.map((session) => {
          const track = session.track_id ? getTrack(session.track_id) : null;
          return (
            <li key={session.id}>
              <Link
                href={`/sessions/${session.id}`}
                className="block rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60 sm:px-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-zinc-100">{session.name}</p>
                    <p className="text-sm text-zinc-500">
                      {track?.name ?? session.track_id ?? "Track"}
                      {session.car ? ` · ${session.car}` : ""}
                      {session.driver_name ? ` · ${session.driver_name}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-lg text-orange-400">
                    {session.bestMs != null
                      ? formatLapTime(session.bestMs)
                      : "—"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
