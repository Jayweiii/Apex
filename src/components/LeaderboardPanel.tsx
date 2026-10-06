"use client";

import { formatLapTime } from "@/lib/format";
import { localLeaderboard } from "@/lib/local-store";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export function LeaderboardPanel({
  trackId,
}: {
  trackId?: string;
}) {
  const [rows, setRows] = useState<ReturnType<typeof localLeaderboard>>([]);
  const [carClass, setCarClass] = useState("");
  const [driver, setDriver] = useState("");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setRows(localLeaderboard({ trackId }));
    });
    return () => window.cancelAnimationFrame(frame);
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
            Best laps from uploads in this browser
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
          No uploaded sessions yet. Import a CSV or GoPro to populate this board.
        </p>
      ) : (
        <ol className="mt-4 divide-y divide-zinc-900 overflow-hidden rounded-xl border border-zinc-800/80">
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
