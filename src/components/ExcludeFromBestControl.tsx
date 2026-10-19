"use client";

/**
 * Single exclude-from-best control (replaces checkbox + duplicate Exclude button).
 * - Idle: "Exclude from best"
 * - Active: "Excluded" with undo (include again)
 * Auto-flag warning stays separate; clicking this control still one-click excludes.
 */
export function ExcludeFromBestControl({
  excluded,
  busy = false,
  reason,
  onChange,
  size = "default",
  title,
}: {
  excluded: boolean;
  busy?: boolean;
  reason?: string | null;
  onChange: (next: { excluded: boolean; exclude_reason?: string | null }) => void;
  size?: "default" | "icon";
  /** Optional override for one-click exclude reason (e.g. auto-flag labels). */
  title?: string;
}) {
  if (size === "icon") {
    return (
      <button
        type="button"
        disabled={busy}
        title={
          excluded
            ? reason
              ? `Excluded: ${reason} (click to undo)`
              : "Excluded from best — click to undo"
            : title ?? "Exclude from best"
        }
        aria-label={
          excluded ? "Excluded from best — undo" : "Exclude from best"
        }
        aria-pressed={excluded}
        onClick={(event) => {
          event.stopPropagation();
          onChange({
            excluded: !excluded,
            exclude_reason: !excluded ? (title ?? "manual") : null,
          });
        }}
        className={`inline-flex size-8 items-center justify-center rounded-md border transition disabled:opacity-50 ${
          excluded
            ? "border-zinc-600 bg-zinc-800 text-zinc-300"
            : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
        }`}
      >
        <ExcludedIcon className="size-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      title={
        excluded
          ? reason
            ? `Excluded: ${reason}`
            : "Excluded from session best and leaderboards"
          : title ?? "Exclude from session best and leaderboards"
      }
      aria-pressed={excluded}
      onClick={() => {
        onChange({
          excluded: !excluded,
          exclude_reason: !excluded ? (title ?? "manual") : null,
        });
      }}
      className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs uppercase tracking-[0.14em] transition disabled:opacity-50 ${
        excluded
          ? "border-zinc-600 bg-zinc-800/80 text-zinc-200"
          : "border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
      }`}
    >
      <ExcludedIcon className="size-3.5" />
      {excluded ? "Excluded" : "Exclude from best"}
    </button>
  );
}

function ExcludedIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.5 4.5l7 7" />
    </svg>
  );
}
