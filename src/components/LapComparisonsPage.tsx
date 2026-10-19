"use client";

import { DiscoverComparisons } from "@/components/DiscoverComparisons";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Tab = "comparisons" | "sessions";

type SessionRow = {
  id: string;
  name: string;
  track_id?: string | null;
  car?: string | null;
  driver_name?: string | null;
  created_at: string;
  user_id?: string;
  visibility?: string | null;
};

function FriendsSessionsFeed() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setRows([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled) setSignedIn(Boolean(user));
        let query = supabase
          .from("sessions")
          .select(
            "id, name, track_id, car, driver_name, created_at, user_id, visibility",
          )
          .order("created_at", { ascending: false })
          .limit(40);
        if (!user) query = query.eq("visibility", "public");
        const { data } = await query;
        if (!cancelled) setRows((data ?? []) as SessionRow[]);
      } catch {
        if (!cancelled) setRows([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows == null) {
    return <p className="text-sm text-zinc-500">Loading sessions…</p>;
  }

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
        {signedIn
          ? "No friends or public sessions yet."
          : "No public sessions yet. Sign in to also see friends-visible uploads."}
      </p>
    );
  }

  return (
    <ul className="grid gap-3">
      {rows.map((session) => {
        const track = session.track_id ? getTrack(session.track_id) : null;
        return (
          <li key={session.id}>
            <Link
              href={`/sessions/${session.id}`}
              className="block rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4 transition hover:border-zinc-700"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-zinc-100">{session.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {track?.name ?? session.track_id ?? "Track"}
                    {session.car ? ` · ${session.car}` : ""}
                    {session.driver_name ? ` · ${session.driver_name}` : ""}
                    {session.visibility ? ` · ${session.visibility}` : ""}
                  </p>
                </div>
                <p className="text-xs text-zinc-600">
                  {new Date(session.created_at).toLocaleDateString()}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function LapComparisonsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const tabParam = search.get("tab");
  const tab: Tab = tabParam === "sessions" ? "sessions" : "comparisons";

  function setTab(next: Tab) {
    const path =
      next === "sessions"
        ? "/lap-comparisons?tab=sessions"
        : "/lap-comparisons";
    router.replace(path);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("comparisons")}
          className={`min-h-10 rounded-lg px-3 text-xs uppercase tracking-[0.16em] ${
            tab === "comparisons"
              ? "bg-zinc-100 text-zinc-900"
              : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Comparisons
        </button>
        <button
          type="button"
          onClick={() => setTab("sessions")}
          className={`min-h-10 rounded-lg px-3 text-xs uppercase tracking-[0.16em] ${
            tab === "sessions"
              ? "bg-zinc-100 text-zinc-900"
              : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          Friends & public
        </button>
      </div>
      {tab === "comparisons" ? <DiscoverComparisons /> : <FriendsSessionsFeed />}
    </div>
  );
}
