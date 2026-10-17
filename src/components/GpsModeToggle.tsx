"use client";

import type { GpsDisplayMode } from "@/lib/map-match";

export function GpsModeToggle({
  mode,
  onChange,
  disabled = false,
  label = "GPS",
  ariaLabel = "GPS display mode",
}: {
  mode: GpsDisplayMode;
  onChange: (mode: GpsDisplayMode) => void;
  disabled?: boolean;
  /** Short prefix shown before the buttons (e.g. Map, Delta). */
  label?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-2 text-xs">
      {label ? (
        <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </span>
      ) : null}
      <div
        className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5"
        role="group"
        aria-label={ariaLabel}
      >
        {(["snapped", "raw"] as const).map((value) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(value)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${
                active
                  ? "bg-zinc-100 text-zinc-950"
                  : "text-zinc-400 hover:text-zinc-200"
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
}
