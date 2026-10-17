"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapList } from "@/components/LapList";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useState } from "react";

type CloudSession = {
  id: string;
  name: string;
  user_id: string;
  car?: string | null;
  driver_name?: string | null;
  track_id?: string | null;
  visibility?: string | null;
  created_at: string;
};

/**
 * Loads a cloud session with the browser Supabase client so auth cookies
 * that work for uploads also work for viewing (avoids LocalSession "not found").
 */
export function CloudSessionView({ id }: { id: string }) {
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<CloudSession | null | undefined>(
    undefined,
  );
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setSession(null);
          setError("Supabase is not configured in this environment.");
        }
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        setEmail(user?.email ?? undefined);
        setUserId(user?.id ?? null);

        const { data: row, error: sessionError } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (cancelled) return;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          return;
        }
        if (!row) {
          setSession(null);
          if (!user) {
            setError("sign-in");
          }
          return;
        }
        setSession(row as CloudSession);

        const { data: lapRows } = await supabase
          .from("laps")
          .select("*")
          .eq("session_id", id)
          .order("lap_number", { ascending: true });
        if (!cancelled) setLaps((lapRows ?? []) as LapRow[]);
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load session");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function onVisibility(next: SessionVisibility) {
    if (!session || !userId || session.user_id !== userId) return;
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("sessions")
      .update({ visibility: next })
      .eq("id", session.id)
      .eq("user_id", userId);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSession({ ...session, visibility: next });
  }

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-500">Loading session…</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          {error === "sign-in" ? (
            <>
              <p className="text-sm text-zinc-300">
                This session is on your Apex account. Sign in to view it (or ask
                the owner to set visibility to Public link).
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/sessions/${id}`)}`}
                className="mt-4 inline-block text-sm text-orange-400"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                {error ?? "Session not found (or you do not have access)."}
              </p>
              <Link href="/account" className="mt-4 inline-block text-sm text-orange-400">
                Account sessions
              </Link>
            </>
          )}
        </main>
      </>
    );
  }

  const best = laps.reduce(
    (min, lap) => Math.min(min, lap.lap_time_ms),
    Number.POSITIVE_INFINITY,
  );
  const href = compareHref(session.id, laps);
  const mine = Boolean(userId && session.user_id === userId);
  const visibility = normalizeVisibility(session.visibility ?? DEFAULT_VISIBILITY);

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href={mine ? "/account" : "/friends"}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {mine ? "Your account sessions" : "Friends"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {session.name}
          </h1>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {session.car ? `${session.car} · ` : ""}
              {laps.length} laps
              {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
              {session.driver_name ? ` · ${session.driver_name}` : ""}
              {mine ? " · saved to your account" : ""}
            </p>
            {href ? (
              <Link
                href={href}
                className="text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
              >
                Compare laps
              </Link>
            ) : null}
          </div>
          {mine ? (
            <SessionVisibilityControl
              value={visibility}
              onChange={onVisibility}
            />
          ) : (
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-600">
              Visibility · {visibility}
            </p>
          )}
        </div>
        {laps.length ? (
          <LapList sessionId={session.id} laps={laps} />
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No laps in this session.
          </p>
        )}
      </main>
    </>
  );
}
