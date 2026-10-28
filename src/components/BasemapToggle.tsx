"use client";

import type { BasemapMode } from "@/lib/basemap-prefs";

/** Single Street | Satellite control shared by Overview, POV, and SF editor. */
export function BasemapToggle({
  value,
  onChange,
  compact,
}: {
  value: BasemapMode;
  onChange: (next: BasemapMode) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 ${
        compact ? "text-[11px]" : "text-xs"
      }`}
      role="group"
      aria-label="Basemap"
      data-apex-basemap-toggle="1"
    >
      {(
        [
          { value: "street" as const, label: "Street" },
          { value: "satellite" as const, label: "Satellite" },
        ] as const
      ).map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            data-apex-basemap-option={option.value}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
              active
                ? "bg-zinc-100 text-zinc-950"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            aria-pressed={active}
            title={
              option.value === "satellite"
                ? "Esri World Imagery (satellite)"
                : "OpenStreetMap (street)"
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
