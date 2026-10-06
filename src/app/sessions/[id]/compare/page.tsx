import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { LocalCompare } from "@/components/LocalGarage";
import { shouldUseLocalSession } from "@/lib/session-route";
import { createClient } from "@/lib/supabase/server";
import type { LapRow, SessionRow } from "@/lib/types";
import Link from "next/link";

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ref?: string; other?: string; otherSession?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;

  if (shouldUseLocalSession(id)) {
    return (
      <LocalCompare
        id={id}
        initialRef={query.ref}
        initialOther={query.other}
        initialOtherSession={query.otherSession}
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: session } = user
    ? await supabase.from("sessions").select("*").eq("id", id).maybeSingle()
    : { data: null };
  if (!user || !session) {
    return (
      <LocalCompare
        id={id}
        initialRef={query.ref}
        initialOther={query.other}
        initialOtherSession={query.otherSession}
      />
    );
  }
  const sessionRow = session as SessionRow;

  const { data: laps } = await supabase
    .from("laps")
    .select("*")
    .eq("session_id", id)
    .order("lap_number", { ascending: true });

  const lapRows = (laps ?? []) as LapRow[];

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <Link
            href={`/sessions/${sessionRow.id}`}
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {sessionRow.name}
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Compare laps
          </h1>
        </div>
        <LapCompare
          laps={lapRows}
          initialRef={query.ref}
          initialOther={query.other}
        />
      </main>
    </>
  );
}
