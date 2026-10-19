"use client";

import {
  VISIBILITY_OPTIONS,
  type SessionVisibility,
} from "@/lib/visibility";

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
  return (
    <fieldset className={compact ? "grid gap-2" : "grid gap-2 sm:max-w-xl"}>
      <legend className="text-sm text-zinc-400">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {VISIBILITY_OPTIONS.map((option) => {
          const active = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={`min-h-10 rounded-lg border px-3 text-sm transition ${
                active
                  ? "border-orange-500/70 bg-orange-500/15 text-orange-200"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              } disabled:opacity-50`}
            >
              <span className="font-medium">{option.label}</span>
              <span className="ml-2 text-xs opacity-70">{option.hint}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
