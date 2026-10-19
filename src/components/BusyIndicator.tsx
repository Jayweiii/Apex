/** Persistent loading bar + message for upload / parse / save. */
export function BusyIndicator({
  message,
  busy,
}: {
  message?: string | null;
  busy: boolean;
}) {
  if (!busy && !message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-3 overflow-hidden rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-3"
    >
      <div className="flex items-center gap-3">
        <span
          className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-orange-400/30 border-t-orange-400"
          aria-hidden
        />
        <p className="min-w-0 text-sm text-orange-100">
          {message || "Working…"}
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900/80">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-orange-400/80" />
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        You can leave this page anytime — work continues or cancels quietly (no
        leave-page warning).
      </p>
    </div>
  );
}
