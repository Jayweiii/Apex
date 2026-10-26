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
          className="apex-btn"
        >
          Discard
        </button>
        <button
          type="button"
          disabled={saving || loading || !dirty}
          onClick={onSave}
          className="apex-btn apex-btn--primary"
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
