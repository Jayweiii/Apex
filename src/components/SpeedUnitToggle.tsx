"use client";

import { SegmentedControl } from "@/components/SegmentedControl";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import type { SpeedUnit } from "@/lib/speed-units";

const OPTIONS = [
  { value: "mph" as const, label: "mph", title: "Miles per hour" },
  { value: "kmh" as const, label: "km/h", title: "Kilometers per hour" },
] as const;

/**
 * mph | km/h segmented control. Persists via localStorage.
 */
export function SpeedUnitToggle({
  className = "",
}: {
  className?: string;
}) {
  const [unit, setUnit] = useSpeedUnit();

  return (
    <SegmentedControl<SpeedUnit>
      value={unit}
      options={OPTIONS}
      onChange={setUnit}
      ariaLabel="Speed units"
      compact
      className={`cursor-pointer ${className}`.trim()}
      groupProps={{
        "data-apex-speed-unit-toggle": "1",
        "data-apex-speed-unit": unit,
      }}
    />
  );
}
