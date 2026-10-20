"use client";

import { DeleteSessionControl } from "@/components/DeleteSessionControl";
import { formatLapTime } from "@/lib/format";
import { bestLapMsBySession } from "@/lib/session-best";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  name: string;
  user_id?: string;
  filename?: string | null;
  visibility?: string | null;
  created_at: string;
  bestMs?: number;
};

/** Own cloud sessions loaded with the browser client (same auth as upload). */
export function AccountSessions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig()) {
        if (!cancelled) setRows([]);
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setUserId(null);
          setRows([]);
          return;
        }
        setUserId(user.id);
        const { data: sessions, error: sessionsError } = await supabase
          .from("sessions")
          .select("id, name, user_id, filename, visibility, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        if (sessionsError) throw new Error(sessionsError.message);
        const list = (sessions ?? []) as Row[];
        const ids = list.map((s) => s.id);
        const bestBySession = await bestLapMsBySession(supabase, ids);
        if (!cancelled) {
          setRows(
            list.map((row) => ({
              ...row,
              bestMs: bestBySession.get(row.id),
            })),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load");
          setRows([]);
        }
      }
    }
    const frame = window.requestAnimationFrame(() => {
      void load();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  const selectedTargets = useMemo(() => {
    if (!rows?.length) return [];
    return rows
      .filter((row) => selected.has(row.id))
      .map((row) => ({
        id: row.id,
        name: row.name,
        user_id: row.user_id ?? userId,
      }));
  }, [rows, selected, userId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!rows?.length) return;
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((row) => row.id));
    });
  }

  function onDeleted(ids: string[]) {
    const gone = new Set(ids);
    setRows((prev) => (prev ?? []).filter((row) => !gone.has(row.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  if (rows === null) {
    return <p className="text-sm text-zinc-500">Loading your sessions…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-300">{error}</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500">No sessions yet, upload one.</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
          <input
            type="checkbox"
            checked={selected.size === rows.length && rows.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
            aria-label="Select all sessions"
          />
          Select all
        </label>
        {selectedTargets.length ? (
          <DeleteSessionControl
            variant="bulk"
            authUserId={userId}
            targets={selectedTargets}
            onDeleted={onDeleted}
          />
        ) : null}
      </div>
      <ul className="grid gap-3">
        {rows.map((session) => {
          const visibility = normalizeVisibility(
            session.visibility ?? DEFAULT_VISIBILITY,
          );
          const checked = selected.has(session.id);
          return (
            <li
              key={session.id}
              className="flex items-stretch gap-2 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-3 py-3 sm:px-4"
            >
              <label className="flex items-center px-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(session.id)}
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                  aria-label={`Select ${session.name}`}
                />
              </label>
              <Link
                href={`/sessions/${session.id}`}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 py-1 transition hover:text-orange-200"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-100">
                    {session.name}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {new Date(session.created_at).toLocaleString()}
                    {` · ${visibility}`}
                    {session.filename ? ` · ${session.filename}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-lg text-orange-400">
                  {session.bestMs != null ? formatLapTime(session.bestMs) : "—"}
                </p>
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
    </div>
  );
}
