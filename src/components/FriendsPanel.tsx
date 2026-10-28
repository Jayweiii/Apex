"use client";

import {
  acceptFriendship,
  listMyFriendships,
  removeFriendship,
  requestFriendByEmail,
  type FriendshipRow,
} from "@/lib/friendships";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { useEffect, useMemo, useState, type FormEvent } from "react";

/**
 * Manage accepted / pending friendships used by visibility = friends.
 */
export function FriendsPanel({ userId }: { userId: string }) {
  const [rows, setRows] = useState<FriendshipRow[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    if (!hasSupabaseConfig()) {
      setRows([]);
      return;
    }
    const supabase = createClient();
    const list = await listMyFriendships(supabase, userId);
    setRows(list);
  }

  useEffect(() => {
    let cancelled = false;
    void reload().catch((err) => {
      if (!cancelled) {
        setRows([]);
        setError(err instanceof Error ? err.message : "Could not load friends");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const accepted = useMemo(
    () => (rows ?? []).filter((row) => row.status === "accepted"),
    [rows],
  );
  const incoming = useMemo(
    () =>
      (rows ?? []).filter(
        (row) => row.status === "pending" && row.addressee_id === userId,
      ),
    [rows, userId],
  );
  const outgoing = useMemo(
    () =>
      (rows ?? []).filter(
        (row) => row.status === "pending" && row.requester_id === userId,
      ),
    [rows, userId],
  );

  async function onRequest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const supabase = createClient();
      await requestFriendByEmail(supabase, email);
      setEmail("");
      setMessage("Friend request sent (or already pending).");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send request");
    } finally {
      setBusy(false);
    }
  }

  async function onAccept(id: string) {
    setBusy(true);
    setError(null);
    try {
      await acceptFriendship(createClient(), id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await removeFriendship(createClient(), id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setBusy(false);
    }
  }

  if (rows == null) {
    return <p className="text-sm text-zinc-500">Loading friends…</p>;
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-200">Friends</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Friends-visible sessions are only shared with people you accept here —
          not every signed-in Apex account.
        </p>
      </div>

      <form onSubmit={onRequest} className="flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="friend@email.com"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
        />
        <button
          type="submit"
          disabled={busy}
          className="apex-btn apex-btn--accent"
        >
          {busy ? "Sending…" : "Add friend"}
        </button>
      </form>

      {incoming.length ? (
        <div className="grid gap-2">
          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Incoming
          </p>
          {incoming.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-sm"
            >
              <span className="font-mono text-xs text-zinc-400">
                {row.requester_id.slice(0, 8)}…
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="apex-btn apex-btn--accent text-xs"
                  onClick={() => void onAccept(row.id)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="apex-btn text-xs"
                  onClick={() => void onRemove(row.id)}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {accepted.length ? (
        <ul className="grid gap-2">
          {accepted.map((row) => {
            const other =
              row.requester_id === userId ? row.addressee_id : row.requester_id;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-zinc-300">
                  {other.slice(0, 8)}…
                </span>
                <button
                  type="button"
                  disabled={busy}
                  className="apex-btn text-xs"
                  onClick={() => void onRemove(row.id)}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-zinc-500">No accepted friends yet.</p>
      )}

      {outgoing.length ? (
        <p className="text-xs text-zinc-600">
          {outgoing.length} pending request{outgoing.length === 1 ? "" : "s"}{" "}
          sent.
        </p>
      ) : null}

      {message ? <p className="text-sm text-emerald-300">{message}</p> : null}
      {error ? <p className="text-sm text-amber-200">{error}</p> : null}
    </section>
  );
}
