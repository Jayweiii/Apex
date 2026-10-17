"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, SessionRow } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

export function CloudCompareView({
  id,
  initialRef,
  initialOther,
  initialOtherSession,
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
}) {
  const [email, setEmail] = useState<string | undefined>();
  const [session, setSession] = useState<SessionRow | null | undefined>(
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
          setError("Supabase is not configured.");
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
          setError(user ? "not-found" : "sign-in");
          return;
        }
        setSession(row as SessionRow);

        const { data: lapRows } = await supabase
          .from("laps")
          .select("*")
          .eq("session_id", id)
          .order("lap_number", { ascending: true });
        if (!cancelled) setLaps((lapRows ?? []) as LapRow[]);
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-500">Loading compare…</p>
        </main>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          {error === "sign-in" ? (
            <>
              <p className="text-sm text-zinc-300">Sign in to compare these laps.</p>
              <Link
                href={`/login?next=${encodeURIComponent(`/sessions/${id}/compare`)}`}
                className="mt-4 inline-block text-sm text-orange-400"
              >
                Sign in
              </Link>
            </>
          ) : (
            <p className="text-sm text-zinc-400">
              {error === "not-found"
                ? "Session not found (or you do not have access)."
                : (error ?? "Session not found.")}
            </p>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <Link
            href={`/sessions/${session.id}`}
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {session.name}
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Compare laps
          </h1>
        </div>
        <LapCompare
          laps={laps}
          initialRef={initialRef}
          initialOther={initialOther}
          initialOtherSession={initialOtherSession}
        />
      </main>
    </>
  );
}
