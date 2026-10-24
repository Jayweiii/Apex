"use client";

import { useSpeedUnit } from "@/components/useSpeedUnit";

/**
 * Single mph ↔ km/h control. Pointer cursor; persists via localStorage.
 */
export function SpeedUnitToggle({
  className = "",
}: {
  className?: string;
}) {
  const [unit, setUnit] = useSpeedUnit();
  const next = unit === "mph" ? "kmh" : "mph";
  const label = unit === "mph" ? "mph" : "km/h";
  const nextLabel = next === "mph" ? "mph" : "km/h";

  return (
    <button
      type="button"
      data-apex-speed-unit-toggle="1"
      data-apex-speed-unit={unit}
      title={`Speed units: ${label} (click for ${nextLabel})`}
      aria-label={`Speed units ${label}. Switch to ${nextLabel}`}
      onClick={() => setUnit(next)}
      className={`cursor-pointer inline-flex min-h-9 items-center rounded-lg border border-zinc-800 bg-zinc-950/80 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100 ${className}`}
    >
      {label}
    </button>
  );
}
