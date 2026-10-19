"use client";

import {
  comparisonSharePath,
  type ComparisonRow,
} from "@/lib/comparisons";
import { listPublicComparisons } from "@/lib/comparisons-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { useEffect, useState } from "react";

export function DiscoverComparisons() {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setRows([]);
      setError("Supabase is not configured.");
      return;
    }
    let cancelled = false;
    listPublicComparisons(createClient())
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setRows([]);
          setError(err instanceof Error ? err.message : "Could not load");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (rows == null) {
    return <p className="text-sm text-zinc-500">Loading public comparisons…</p>;
  }

  if (error && /comparisons.*does not exist|Could not find the table/i.test(error)) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
        Apply{" "}
        <code className="text-zinc-300">
          supabase/migrations/20261019_comparisons.sql
        </code>{" "}
        in the Supabase SQL editor to enable Lap Comparisons.
      </p>
    );
  }

  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-sm text-zinc-500">
        No public comparisons yet. Save one from a compare view and set
        visibility to Public.
      </p>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={comparisonSharePath(row.id)}
            className="block rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-4 transition hover:border-zinc-600"
          >
            <p className="text-sm font-medium text-zinc-100">{row.title}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {row.items.length} laps
              {row.description ? ` · ${row.description.slice(0, 80)}` : ""}
            </p>
          </Link>
        </li>
      ))}
      {error ? (
        <li className="sm:col-span-2 text-sm text-amber-200">{error}</li>
      ) : null}
    </ul>
  );
}
