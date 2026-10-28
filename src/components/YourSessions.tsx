"use client";

import { DeleteSessionControl } from "@/components/DeleteSessionControl";
import { formatLapTime } from "@/lib/format";
import { bestLapMsBySession } from "@/lib/session-best";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type CloudSessionListItem = {
  id: string;
  name: string;
  user_id?: string;
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
  const [userId, setUserId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<CloudSessionListItem[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    if (!hasSupabaseConfig()) {
      setSessions([]);
      return;
    }
    const supabase = createClient();

    async function loadForUser(userId: string) {
      const { data: rows, error } = await supabase
        .from("sessions")
        .select("id, name, user_id, track_id, car, visibility, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (cancelled) return;
      if (error) {
        setSessions([]);
        return;
      }
      const list = (rows ?? []) as CloudSessionListItem[];
      const ids = list.map((row) => row.id);
      const bestBySession = ids.length
        ? await bestLapMsBySession(supabase, ids)
        : new Map<string, number>();
      if (!cancelled) {
        setSessions(
          list.map((row) => ({
            ...row,
            bestMs: bestBySession.get(row.id),
          })),
        );
      }
    }

    async function bootstrap() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setSignedIn(false);
          setUserId(null);
          setSessions([]);
          return;
        }
        setSignedIn(true);
        setUserId(user.id);
        await loadForUser(user.id);
      } catch {
        if (!cancelled) setSessions([]);
      }
    }

    void bootstrap();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      const user = session?.user ?? null;
      if (!user) {
        setSignedIn(false);
        setUserId(null);
        setSessions([]);
        return;
      }
      setSignedIn(true);
      setUserId(user.id);
      void loadForUser(user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const selectedTargets = useMemo(() => {
    if (!sessions?.length) return [];
    return sessions
      .filter((row) => selected.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        user_id: row.user_id ?? userId,
      }));
  }, [sessions, selected, userId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onDeleted(ids: string[]) {
    const gone = new Set(ids);
    setSessions((prev) => (prev ?? []).filter((row) => !gone.has(row.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  // Signed-out: hide entirely (no "Checking account" wall). Guests (anon) still show.
  if (sessions === null || !signedIn) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">My Sessions</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Saved to your account ·{" "}
            <Link href="/account" className="text-orange-400 hover:text-orange-300">
              Account
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sessions.length ? (
            <p className="text-xs text-zinc-600">{sessions.length} recent</p>
          ) : null}
          {selectedTargets.length ? (
            <DeleteSessionControl
              variant="bulk"
              authUserId={userId}
              targets={selectedTargets}
              onDeleted={onDeleted}
            />
          ) : null}
        </div>
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
              <li
                key={session.id}
                className="flex items-stretch gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3 sm:px-4"
              >
                <label className="flex items-center px-1">
                  <input
                    type="checkbox"
                    checked={selected.has(session.id)}
                    onChange={() => toggle(session.id)}
                    className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                    aria-label={`Select ${session.name}`}
                  />
                </label>
                <Link
                  href={`/sessions/${session.id}`}
                  className="block min-w-0 flex-1 py-1 transition hover:text-orange-200"
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
                <div className="flex items-center">
                  <DeleteSessionControl
                    variant="row"
                    authUserId={userId}
                    targets={[
                      {
                        id: session.id,
                        name: session.name,
                        user_id: session.user_id ?? userId,
                      },
                    ]}
                    onDeleted={onDeleted}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
