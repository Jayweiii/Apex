"use client";

import { useEffect } from "react";

/**
 * Explicit Save / Discard for session edits. Warns before navigate away only
 * when there are unsaved edits and the session is not still loading.
 */
export function UnsavedChangesBar({
  dirty,
  saving = false,
  loading = false,
  error = null,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving?: boolean;
  /** When true, do not attach beforeunload (initial load). */
  loading?: boolean;
  error?: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  useEffect(() => {
    if (!dirty || loading) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, loading]);

  if (!dirty && !error) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-orange-500/40 bg-orange-500/10 px-3 py-2"
    >
      <p className="text-sm text-orange-100">
        {error ? error : "Unsaved changes"}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving || loading || !dirty}
          onClick={onDiscard}
          className="inline-flex min-h-9 items-center rounded-lg border border-zinc-700 px-3 text-xs uppercase tracking-[0.14em] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={saving || loading || !dirty}
          onClick={onSave}
          className="inline-flex min-h-9 items-center rounded-lg bg-orange-500 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-black shadow-[0_0_0_2px_rgba(249,115,22,0.35)] hover:bg-orange-400 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Pure helper for tests — navigate-away warn only when dirty and not loading. */
export function shouldWarnBeforeUnload(dirty: boolean, loading: boolean) {
  return dirty && !loading;
}
