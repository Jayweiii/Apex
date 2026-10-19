"use client";

import {
  comparisonSharePath,
  type ComparisonRow,
} from "@/lib/comparisons";
import {
  deleteComparison,
  listMyComparisons,
} from "@/lib/comparisons-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function SavedComparisonsList() {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        if (!user) {
          if (!cancelled) setRows([]);
          return;
        }
        const list = await listMyComparisons(supabase, user.id);
        if (!cancelled) setRows(list);
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const supabase = createClient();
      await deleteComparison(supabase, id);
      setRows((prev) => (prev ?? []).filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusyId(null);
    }
  }

  if (rows == null) {
    return <p className="text-sm text-zinc-500">Loading comparisons…</p>;
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-medium text-zinc-100">Saved comparisons</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Shareable multi-lap compares. Public ones also appear on Discover.
        </p>
      </div>
      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
      {!rows.length ? (
        <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
          No saved comparisons yet. Open a compare view and tap Save comparison.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-900 rounded-2xl border border-zinc-800/80">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <Link
                  href={comparisonSharePath(row.id)}
                  className="text-sm font-medium text-zinc-100 hover:text-orange-300"
                >
                  {row.title}
                </Link>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {row.items.length} laps · {row.visibility}
                  {row.forked_from ? " · forked" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={comparisonSharePath(row.id)}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-zinc-400 hover:border-zinc-600"
                >
                  Open
                </Link>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void remove(row.id)}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300 disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
