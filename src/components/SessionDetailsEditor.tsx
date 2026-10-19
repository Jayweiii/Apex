"use client";

/**
 * Draft-only session details editor. Parent owns Save / Discard.
 */
export function SessionDetailsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: {
    name: string;
    car?: string | null;
    driver_name?: string | null;
    notes?: string | null;
  };
  onChange: (next: {
    name: string;
    car: string;
    driver_name: string;
    notes: string;
  }) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Edit session name, car, driver, and notes. Changes stay local until you
        tap Save.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Name</span>
        <input
          disabled={disabled}
          value={value.name}
          onChange={(event) =>
            onChange({
              name: event.target.value,
              car: value.car ?? "",
              driver_name: value.driver_name ?? "",
              notes: value.notes ?? "",
            })
          }
          className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Car</span>
        <input
          disabled={disabled}
          value={value.car ?? ""}
          onChange={(event) =>
            onChange({
              name: value.name,
              car: event.target.value,
              driver_name: value.driver_name ?? "",
              notes: value.notes ?? "",
            })
          }
          className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Driver</span>
        <input
          disabled={disabled}
          value={value.driver_name ?? ""}
          onChange={(event) =>
            onChange({
              name: value.name,
              car: value.car ?? "",
              driver_name: event.target.value,
              notes: value.notes ?? "",
            })
          }
          className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Notes</span>
        <textarea
          disabled={disabled}
          value={value.notes ?? ""}
          rows={3}
          onChange={(event) =>
            onChange({
              name: value.name,
              car: value.car ?? "",
              driver_name: value.driver_name ?? "",
              notes: event.target.value,
            })
          }
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      </label>
    </div>
  );
}
