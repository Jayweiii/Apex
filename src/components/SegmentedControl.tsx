"use client";

/**
 * Mutually exclusive mode control (HIG segmented / APG toggle button group).
 * Use for mph|km/h, Street|Satellite, Overview/POV, Time|Distance — not actions.
 */
export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  title?: string;
  /** Extra data-* on the option button (e.g. data-apex-pov-option). */
  dataAttrs?: Record<string, string>;
};

type GroupDataProps = {
  "data-apex-speed-unit-toggle"?: string;
  "data-apex-speed-unit"?: string;
  "data-apex-basemap-toggle"?: string;
  "data-apex-pov-toggle"?: string;
  "data-apex-pov-mode"?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  compact,
  accent,
  disabled,
  className = "",
  testId,
  groupProps,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (next: T) => void;
  ariaLabel: string;
  compact?: boolean;
  /** Orange selected chip (map camera). Default is light selected chip. */
  accent?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
  /** Extra attributes on the group (e.g. data-apex-speed-unit). */
  groupProps?: GroupDataProps;
}) {
  return (
    <div
      className={`apex-segment${compact ? " apex-segment--compact" : ""} ${className}`.trim()}
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      {...groupProps}
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`apex-segment__option${
              accent ? " apex-segment__option--accent" : ""
            }`}
            aria-pressed={active}
            title={option.title}
            {...option.dataAttrs}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
