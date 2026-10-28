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
      className={`apex-btn cursor-pointer ${className}`.trim()}
    >
      {label}
    </button>
  );
}
