"use client";

import { SegmentedControl } from "@/components/SegmentedControl";
import {
  VISIBILITY_OPTIONS,
  type SessionVisibility,
} from "@/lib/visibility";

/**
 * Private | Friends | Public — one segmented control (docs/UI_RULES.md: a
 * choice of modes is a segmented control), with the selected option's
 * meaning spelled out underneath.
 */
export function SessionVisibilityControl({
  value,
  onChange,
  disabled,
  compact,
  legend = "Who can see this session?",
}: {
  value: SessionVisibility;
  onChange: (next: SessionVisibility) => void;
  disabled?: boolean;
  compact?: boolean;
  legend?: string;
}) {
  const selected = VISIBILITY_OPTIONS.find((option) => option.value === value);
  return (
    <div
      className={compact ? "grid gap-1.5" : "grid gap-1.5 sm:max-w-xl"}
      data-apex-visibility-control="1"
    >
      <p className="text-sm text-zinc-400" id="apex-visibility-legend">
        {legend}
      </p>
      <SegmentedControl<SessionVisibility>
        value={value}
        options={VISIBILITY_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
          title: option.hint,
        }))}
        onChange={onChange}
        ariaLabel={legend}
        accent
        disabled={disabled}
        className="apex-segment--fill"
      />
      {selected ? (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {selected.hint}
        </p>
      ) : null}
    </div>
  );
}
