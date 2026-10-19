"use client";

/**
 * Owner-facing re-parse affordances — always outside the Tools drawer.
 * Used in the lap list header and as a mobile banner when laps look unsplit.
 */

export function ReparseLapsButton({
  onClick,
  emphasize = false,
  className,
}: {
  onClick: () => void;
  /** Stronger style when laps look unsplit. */
  emphasize?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        className ??
        (emphasize
          ? "inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg bg-orange-500 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-black hover:bg-orange-400"
          : "inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg border border-orange-500/50 bg-orange-500/10 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-200 hover:border-orange-400 hover:bg-orange-500/20")
      }
    >
      Re-parse laps
    </button>
  );
}

export function UnsplitLapsBanner({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-amber-500/45 bg-amber-500/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
    >
      <p className="min-w-0 text-sm leading-snug text-amber-50">
        Looks like laps weren&apos;t split. Re-parse laps
      </p>
      <ReparseLapsButton onClick={onClick} emphasize className="w-full sm:w-auto" />
    </div>
  );
}
