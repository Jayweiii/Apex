import { AppHeader } from "@/components/AppHeader";
import { LocalSession } from "@/components/LocalGarage";
import { LapList } from "@/components/LapList";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { LapRow, SessionRow } from "@/lib/types";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return <LocalSession id={id} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();
  const sessionRow = session as SessionRow;

  const { data: laps } = await supabase
    .from("laps")
    .select("*")
    .eq("session_id", id)
    .order("lap_number", { ascending: true });

  const lapRows = (laps ?? []) as LapRow[];
  const best = lapRows.reduce(
    (min, lap) => Math.min(min, lap.lap_time_ms),
    Number.POSITIVE_INFINITY,
  );
  const href = compareHref(sessionRow.id, lapRows);

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            All sessions
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            {sessionRow.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              {lapRows.length} laps
              {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
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
        </div>
        {lapRows.length ? (
          <LapList sessionId={sessionRow.id} laps={lapRows} />
        ) : (
          <p className="text-sm text-zinc-500">No laps in this session.</p>
        )}
      </main>
    </>
  );
}
