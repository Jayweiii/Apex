"use client";

import { formatLapTime } from "@/lib/format";
import {
  localLeaderboard,
  type LeaderboardRow,
} from "@/lib/local-store";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack, trackEquivalentIds } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export function LeaderboardPanel({
  trackId,
}: {
  trackId?: string;
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [carClass, setCarClass] = useState("");
  const [driver, setDriver] = useState("");
  const [sourceNote, setSourceNote] = useState("this browser");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const aliases = trackId ? trackEquivalentIds(trackId) : [];
      const local = localLeaderboard({
        trackId,
        trackIds: aliases.length ? aliases : undefined,
      });
      let cloud: LeaderboardRow[] = [];
      if (hasSupabaseConfig()) {
        try {
          const supabase = createClient();
          const {
            data: { user },
          } = await supabase.auth.getUser();
          // RLS: signed-out sees public; signed-in sees own + friends + public.
          let query = supabase
            .from("sessions")
            .select("id, name, track_id, car, car_class, driver_name, tires, weather")
            .order("created_at", { ascending: false })
            .limit(100);
          if (trackId) {
            query =
              aliases.length > 1
                ? query.in("track_id", aliases)
                : query.eq("track_id", trackId);
          }
          const { data: sessions } = await query;
          const ids = (sessions ?? []).map((s) => s.id);
          if (ids.length) {
            const { data: laps } = await supabase
              .from("laps")
              .select("session_id, lap_time_ms")
              .in("session_id", ids);
            const bestBySession = new Map<string, number>();
            for (const lap of laps ?? []) {
              const current = bestBySession.get(lap.session_id);
              if (current == null || lap.lap_time_ms < current) {
                bestBySession.set(lap.session_id, lap.lap_time_ms);
              }
            }
            cloud = (sessions ?? [])
              .filter((session) => session.track_id && bestBySession.has(session.id))
              .map((session) => ({
                trackId: session.track_id as string,
                carClass: session.car_class || "Open",
                driver: session.driver_name || "Unknown",
                car: session.car || "Unknown",
                bestMs: bestBySession.get(session.id)!,
                sessionId: session.id,
                sessionName: session.name,
                tires: session.tires ?? undefined,
                weather: session.weather ?? undefined,
              }));
          }
          if (!cancelled) {
            setSourceNote(
              user
                ? "your account + public + this browser"
                : cloud.length
                  ? "public sessions + this browser"
                  : "this browser",
            );
          }
        } catch {
          // keep local only
        }
      }
      if (cancelled) return;
      const merged = new Map<string, LeaderboardRow>();
      for (const row of [...cloud, ...local]) {
        const key = `${row.sessionId}`;
        const existing = merged.get(key);
        if (!existing || row.bestMs < existing.bestMs) merged.set(key, row);
      }
      setRows(
        [...merged.values()].sort(
          (a, b) => a.bestMs - b.bestMs || a.driver.localeCompare(b.driver),
        ),
      );
    }
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [trackId]);

  const classes = useMemo(
    () => [...new Set(rows.map((row) => row.carClass))].sort(),
    [rows],
  );
  const drivers = useMemo(
    () => [...new Set(rows.map((row) => row.driver))].sort(),
    [rows],
  );
  const filtered = rows.filter((row) => {
    if (carClass && row.carClass !== carClass) return false;
    if (driver && row.driver !== driver) return false;
    return true;
  });

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Leaderboard</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Best laps from {sourceNote}
            {trackId ? ` at ${getTrack(trackId)?.name ?? trackId}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={carClass}
            onChange={(event) => setCarClass(event.target.value)}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          >
            <option value="">All classes</option>
            {classes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <select
            value={driver}
            onChange={(event) => setDriver(event.target.value)}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          >
            <option value="">All drivers</option>
            {drivers.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
          No sessions yet, upload one.
        </p>
      ) : (
        <ol className="mt-4 max-h-[min(40vh,360px)] divide-y divide-zinc-900 overflow-y-auto rounded-xl border border-zinc-800/80">
          {filtered.slice(0, 20).map((row, index) => (
            <li key={`${row.sessionId}-${row.driver}-${row.car}`}>
              <Link
                href={`/sessions/${row.sessionId}`}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-900/60"
              >
                <div className="min-w-0">
                  <p className="font-medium text-zinc-100">
                    <span className="mr-2 font-mono text-zinc-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {row.driver}
                  </p>
                  <p className="mt-1 truncate text-xs text-zinc-500">
                    {row.car}
                    {" · "}
                    {row.carClass}
                    {row.tires ? ` · ${row.tires}` : ""}
                    {row.weather ? ` · ${row.weather}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-lg text-orange-400">
                  {formatLapTime(row.bestMs)}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
