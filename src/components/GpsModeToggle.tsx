"use client";

import { SegmentedControl } from "@/components/SegmentedControl";
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
      <SegmentedControl<GpsDisplayMode>
        value={mode}
        options={
          [
            { value: "snapped" as const, label: "Snapped" },
            { value: "raw" as const, label: "Raw" },
          ] as const
        }
        onChange={onChange}
        ariaLabel={ariaLabel}
        compact
        disabled={disabled}
      />
    </div>
  );
}
