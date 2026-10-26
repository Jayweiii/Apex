"use client";

/**
 * Single exclude/include control (one action, no duplicates).
 * - Idle: "Exclude"
 * - Active: "Include" (undo)
 * Row size keeps a clear label for iPhone; icon-only is opt-in.
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
  size?: "default" | "row" | "icon";
  /** Optional override for one-click exclude reason (e.g. auto-flag labels). */
  title?: string;
}) {
  const label = excluded ? "Include" : "Exclude";
  const aria = excluded
    ? "Include lap in best"
    : title ?? "Exclude lap from best";

  if (size === "icon") {
    return (
      <button
        type="button"
        disabled={busy}
        title={
          excluded
            ? reason
              ? `Excluded: ${reason} (tap to include)`
              : "Excluded from best — tap to include"
            : title ?? "Exclude from best"
        }
        aria-label={aria}
        aria-pressed={excluded}
        onClick={(event) => {
          event.stopPropagation();
          onChange({
            excluded: !excluded,
            exclude_reason: !excluded ? (title ?? "manual") : null,
          });
        }}
        className={`apex-btn apex-btn--icon ${
          excluded ? "apex-btn--pressed" : ""
        }`}
      >
        <ExcludedIcon className="size-3.5" />
      </button>
    );
  }

  if (size === "row") {
    return (
      <button
        type="button"
        disabled={busy}
        title={
          excluded
            ? reason
              ? `Excluded: ${reason}`
              : "Excluded from session best — tap to include"
            : title ?? "Exclude from session best"
        }
        aria-label={aria}
        aria-pressed={excluded}
        data-testid="lap-exclude-toggle"
        onClick={(event) => {
          event.stopPropagation();
          onChange({
            excluded: !excluded,
            exclude_reason: !excluded ? (title ?? "manual") : null,
          });
        }}
        className={`apex-btn min-w-[4.75rem] px-2 text-[10px] tracking-[0.08em] ${
          excluded ? "apex-btn--pressed" : ""
        }`}
      >
        <ExcludedIcon className="size-3.5 shrink-0" />
        <span>{label}</span>
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
      className={`apex-btn ${excluded ? "apex-btn--pressed" : ""}`}
    >
      <ExcludedIcon className="size-3.5" />
      {excluded ? "Include in best" : "Exclude from best"}
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
