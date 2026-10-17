"use client";

import { AppHeader } from "@/components/AppHeader";
import { LapCharts } from "@/components/LapCharts";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, TelemetryPoint } from "@/lib/types";
import Link from "next/link";
import { useEffect, useState } from "react";

type CloudSession = {
  id: string;
  name: string;
};

/**
 * Browser-auth lap view for cloud session UUIDs (avoids LocalLap "not found").
 */
export function CloudLapView({
  sessionId,
  lapId,
}: {
  sessionId: string;
  lapId: string;
}) {
  const [email, setEmail] = useState<string | undefined>();
  const [session, setSession] = useState<CloudSession | null | undefined>(
    undefined,
  );
  const [lap, setLap] = useState<LapRow | null>(null);
  const [siblings, setSiblings] = useState<
    Array<{ id: string; lap_time_ms: number }>
  >([]);
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
          .select("id, name")
          .eq("id", sessionId)
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
        setSession(row as CloudSession);

        const { data: lapRow } = await supabase
          .from("laps")
          .select("*")
          .eq("id", lapId)
          .eq("session_id", sessionId)
          .maybeSingle();
        if (cancelled) return;
        if (!lapRow) {
          setLap(null);
          setError("not-found");
          return;
        }
        setLap(lapRow as LapRow);

        const { data: sibs } = await supabase
          .from("laps")
          .select("id, lap_time_ms")
          .eq("session_id", sessionId);
        if (!cancelled) {
          setSiblings((sibs ?? []) as Array<{ id: string; lap_time_ms: number }>);
        }
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load lap");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, lapId]);

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          <p className="text-sm text-zinc-500">Loading lap…</p>
        </main>
      </>
    );
  }

  if (!session || !lap) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-5xl px-6 py-8">
          {error === "sign-in" ? (
            <>
              <p className="text-sm text-zinc-300">
                Sign in to view this lap, or ask the owner for a public link.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/sessions/${sessionId}/laps/${lapId}`)}`}
                className="mt-4 inline-block text-sm text-orange-400"
              >
                Sign in
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-400">
                {error === "not-found"
                  ? "Lap not found (or you do not have access)."
                  : (error ?? "Lap not found.")}
              </p>
              <Link
                href={`/sessions/${sessionId}`}
                className="mt-4 inline-block text-sm text-orange-400"
              >
                Back to session
              </Link>
            </>
          )}
        </main>
      </>
    );
  }

  const points = (lap.telemetry ?? []) as TelemetryPoint[];
  const peak = points.reduce((max, point) => Math.max(max, point.speed), 0);
  const href = compareHref(session.id, siblings, lap.id);

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
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                Lap {lap.lap_number}
              </h1>
              <p className="mt-1 font-mono text-3xl text-orange-400">
                {formatLapTime(lap.lap_time_ms)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <p className="text-sm text-zinc-500">Peak {peak.toFixed(0)} km/h</p>
              {href ? (
                <Link
                  href={href}
                  className="text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
                >
                  Compare laps
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {points.length ? (
          <LapCharts points={points} label={`Lap ${lap.lap_number}`} />
        ) : (
          <p className="text-sm text-zinc-500">No speed samples on this lap.</p>
        )}
      </main>
    </>
  );
}
