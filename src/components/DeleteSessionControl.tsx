"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  deleteOwnedSessions,
  type SessionDeleteTarget,
} from "@/lib/session-delete";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

function formatNames(targets: SessionDeleteTarget[]): ReactNode {
  if (targets.length === 1) {
    return (
      <>
        Permanently delete{" "}
        <span className="font-medium text-zinc-100">{targets[0].name}</span>?
        Laps, videos, sync, trims, and excludes are removed. Comparisons that
        only used this session are deleted; others drop the missing lap.
        Leaderboards update automatically.
      </>
    );
  }
  const preview = targets
    .slice(0, 4)
    .map((t) => t.name)
    .join(", ");
  const more =
    targets.length > 4 ? ` and ${targets.length - 4} more` : "";
  return (
    <>
      Permanently delete{" "}
      <span className="font-medium text-zinc-100">
        {targets.length} sessions
      </span>{" "}
      ({preview}
      {more})? Cascades laps, videos/sync, trims, and excludes. Your
      comparisons are scrubbed or removed; leaderboards refresh.
    </>
  );
}

/**
 * Owner delete — confirm dialog names the session(s), then cascades via
 * `deleteOwnedSessions` (RLS owner-only).
 */
export function DeleteSessionControl({
  targets,
  authUserId,
  variant = "toolbar",
  onDeleted,
  disabled = false,
  className,
  label,
}: {
  targets: SessionDeleteTarget[];
  authUserId: string | null | undefined;
  variant?: "toolbar" | "row" | "bulk";
  onDeleted?: (ids: string[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usable = targets.filter((t) => t.id);
  if (!usable.length || !authUserId) return null;

  const buttonLabel =
    label ??
    (variant === "bulk"
      ? `Delete ${usable.length}`
      : variant === "toolbar"
        ? "Delete session"
        : "Delete");

  async function runDelete() {
    if (!hasSupabaseConfig()) {
      setError("Supabase is not configured");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await deleteOwnedSessions(supabase, authUserId!, usable);
      setOpen(false);
      onDeleted?.(result.deletedIds);
      if (variant === "toolbar") {
        router.push("/account");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    } finally {
      setBusy(false);
    }
  }

  const dangerClass =
    variant === "toolbar"
      ? "inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-red-200 hover:border-red-400 hover:bg-red-500/20"
      : variant === "bulk"
        ? "inline-flex min-h-9 items-center rounded-lg border border-red-500/50 bg-red-500/10 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-red-200 hover:bg-red-500/20 disabled:opacity-40"
        : "inline-flex min-h-8 items-center rounded-lg border border-red-500/40 px-2.5 text-[11px] uppercase tracking-[0.12em] text-red-300 hover:border-red-400 hover:bg-red-500/10 disabled:opacity-40";

  return (
    <>
      <button
        type="button"
        data-testid={
          variant === "toolbar"
            ? "toolbar-delete-session"
            : variant === "bulk"
              ? "bulk-delete-sessions"
              : "row-delete-session"
        }
        disabled={disabled || busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={className ?? dangerClass}
      >
        {variant === "toolbar" ? <span aria-hidden>⌫</span> : null}
        {buttonLabel}
      </button>
      <ConfirmDialog
        open={open}
        danger
        busy={busy}
        title={
          usable.length === 1 ? "Delete session?" : "Delete sessions?"
        }
        body={
          <div className="space-y-2">
            <p>{formatNames(usable)}</p>
            {error ? <p className="text-red-300">{error}</p> : null}
          </div>
        }
        confirmLabel={
          usable.length === 1 ? "Delete session" : `Delete ${usable.length}`
        }
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        onConfirm={() => void runDelete()}
      />
    </>
  );
}
