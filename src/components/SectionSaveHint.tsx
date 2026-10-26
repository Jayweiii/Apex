"use client";

/**
 * Compact unsaved-changes cue next to the section that owns the draft.
 * Shares Save/Discard with the page-level UnsavedChangesBar.
 */
export function SectionSaveHint({
  dirty,
  saving = false,
  label = "Unsaved changes",
  onSave,
  onDiscard,
  className,
}: {
  dirty: boolean;
  saving?: boolean;
  label?: string;
  onSave?: () => void;
  onDiscard?: () => void;
  className?: string;
}) {
  if (!dirty) return null;

  return (
    <div
      role="status"
      data-testid="section-save-hint"
      className={`flex flex-wrap items-center gap-2 rounded-lg border border-orange-500/40 bg-orange-500/10 px-2 py-1.5 ${className ?? ""}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-orange-100">
        {label}
      </p>
      {onDiscard ? (
        <button
          type="button"
          disabled={saving}
          onClick={onDiscard}
          className="apex-btn apex-btn--ghost"
        >
          Discard
        </button>
      ) : null}
      {onSave ? (
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="apex-btn apex-btn--primary"
          data-testid="section-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      ) : null}
    </div>
  );
}
