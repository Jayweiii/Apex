"use client";

import { SegmentedControl } from "@/components/SegmentedControl";
import type { BasemapMode } from "@/lib/basemap-prefs";

const OPTIONS = [
  {
    value: "street" as const,
    label: "Street",
    title: "OpenStreetMap (street)",
    dataAttrs: { "data-apex-basemap-option": "street" },
  },
  {
    value: "satellite" as const,
    label: "Satellite",
    title: "Esri World Imagery (satellite)",
    dataAttrs: { "data-apex-basemap-option": "satellite" },
  },
] as const;

/** Street | Satellite segmented control shared by Overview, POV, and SF editor. */
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
    <SegmentedControl<BasemapMode>
      value={value}
      options={OPTIONS}
      onChange={onChange}
      ariaLabel="Basemap"
      compact={compact}
      className="cursor-pointer"
      groupProps={{ "data-apex-basemap-toggle": "1" }}
    />
  );
}
