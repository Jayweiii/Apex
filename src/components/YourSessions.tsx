"use client";

import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useState } from "react";

type CloudSessionListItem = {
  id: string;
  name: string;
  track_id?: string | null;
  car?: string | null;
  visibility?: string | null;
  created_at: string;
  bestMs?: number;
};

/**
 * Signed-in user's cloud sessions on the home page — appears as soon as
 * uploads land in Supabase (browser client, same auth as upload).
 */
export function YourSessions() {
  const [signedIn, setSignedIn] = useState(false);
  const [sessions, setSessions] = useState<CloudSessionListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) setSessions([]);
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setSignedIn(false);
          setSessions([]);
          return;
        }
        setSignedIn(true);

        const { data: rows } = await supabase
          .from("sessions")
          .select("id, name, track_id, car, visibility, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(20);
        if (cancelled) return;
        const list = (rows ?? []) as CloudSessionListItem[];
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
          setSessions(
            list.map((row) => ({
              ...row,
              bestMs: bestBySession.get(row.id),
            })),
          );
        }
      } catch {
        if (!cancelled) setSessions([]);
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

  // Signed-out: hide entirely (no "Checking account" wall). Guests (anon) still show.
  if (sessions === null || !signedIn) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Your sessions</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Saved to your account ·{" "}
            <Link href="/account" className="text-orange-400 hover:text-orange-300">
              Account
            </Link>
          </p>
        </div>
        {sessions.length ? (
          <p className="text-xs text-zinc-600">{sessions.length} recent</p>
        ) : null}
      </div>
      {sessions.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
          No sessions yet, upload one.
        </p>
      ) : (
        <ul className="grid gap-3">
          {sessions.map((session) => {
            const track = session.track_id ? getTrack(session.track_id) : null;
            const visibility: SessionVisibility = normalizeVisibility(
              session.visibility ?? DEFAULT_VISIBILITY,
            );
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
                        {` · ${visibility}`}
                      </p>
                      <p className="text-xs text-zinc-600">
                        {new Date(session.created_at).toLocaleString()}
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
      )}
    </section>
  );
}
