import { AppHeader } from "@/components/AppHeader";
import { SessionUpload } from "@/components/SessionUpload";
import { formatLapTime } from "@/lib/format";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { LapRow, SessionRow } from "@/lib/types";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  if (!hasSupabaseConfig()) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await supabase
    .from("sessions")
    .select("*")
    .order("created_at", { ascending: false });

  const sessionRows = (sessions ?? []) as SessionRow[];
  const sessionIds = sessionRows.map((session) => session.id);
  const { data: laps } = sessionIds.length
    ? await supabase
        .from("laps")
        .select("session_id, lap_time_ms")
        .in("session_id", sessionIds)
    : { data: [] as { session_id: string; lap_time_ms: number }[] };

  const bestBySession = new Map<string, number>();
  for (const lap of (laps ?? []) as Pick<LapRow, "session_id" | "lap_time_ms">[]) {
    const current = bestBySession.get(lap.session_id);
    if (current == null || lap.lap_time_ms < current) {
      bestBySession.set(lap.session_id, lap.lap_time_ms);
    }
  }

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            This browser
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Account sessions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Saved to your account. Import a CSV and Apex will split it into laps.
          </p>
        </div>
        <SessionUpload />
        {sessionRows.length === 0 ? (
          <p className="text-sm text-zinc-500">No sessions yet.</p>
        ) : (
          <ul className="grid gap-3">
            {sessionRows.map((session) => {
              const best = bestBySession.get(session.id);
              return (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="flex items-center justify-between rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-5 py-4 transition hover:border-zinc-700 hover:bg-zinc-900/60"
                  >
                    <div>
                      <p className="font-medium text-zinc-100">{session.name}</p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {[session.track_name, session.car].filter(Boolean).join(" · ")}
                        {(session.track_name || session.car) ? " · " : ""}
                        {new Date(session.created_at).toLocaleString()}
                        {session.filename ? ` · ${session.filename}` : ""}
                      </p>
                    </div>
                    <p className="font-mono text-lg text-orange-400">
                      {best != null ? formatLapTime(best) : "—"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
