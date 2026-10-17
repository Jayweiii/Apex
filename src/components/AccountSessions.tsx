"use client";

import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  name: string;
  filename?: string | null;
  visibility?: string | null;
  created_at: string;
  bestMs?: number;
};

/** Own cloud sessions loaded with the browser client (same auth as upload). */
export function AccountSessions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) setRows([]);
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setRows([]);
          return;
        }
        const { data: sessions, error: sessionsError } = await supabase
          .from("sessions")
          .select("id, name, filename, visibility, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (sessionsError) throw new Error(sessionsError.message);
        const list = (sessions ?? []) as Row[];
        const ids = list.map((s) => s.id);
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
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load");
          setRows([]);
        }
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

  if (rows === null) {
    return <p className="text-sm text-zinc-500">Loading your sessions…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-300">{error}</p>;
  }
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">No sessions yet.</p>;
  }

  return (
    <ul className="grid gap-3">
      {rows.map((session) => {
        const visibility = normalizeVisibility(
          session.visibility ?? DEFAULT_VISIBILITY,
        );
        return (
          <li key={session.id}>
            <Link
              href={`/sessions/${session.id}`}
              className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
            >
              <div>
                <p className="font-medium text-zinc-100">{session.name}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {new Date(session.created_at).toLocaleString()}
                  {` · ${visibility}`}
                  {session.filename ? ` · ${session.filename}` : ""}
                </p>
              </div>
              <p className="font-mono text-lg text-orange-400">
                {session.bestMs != null ? formatLapTime(session.bestMs) : "—"}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
