"use client";

import type { GpsDisplayMode } from "@/lib/map-match";

export function GpsModeToggle({
  mode,
  onChange,
  disabled = false,
}: {
  mode: GpsDisplayMode;
  onChange: (mode: GpsDisplayMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs"
      role="group"
      aria-label="GPS display mode"
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
  );
}
