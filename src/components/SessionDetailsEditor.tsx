"use client";

/**
 * Draft-only session details editor. Parent owns Save / Discard.
 * Includes weather / tire notes next to name, car, driver, and freeform notes.
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
    weather?: string | null;
    tires?: string | null;
  };
  onChange: (next: {
    name: string;
    car: string;
    driver_name: string;
    notes: string;
    weather: string;
    tires: string;
  }) => void;
  disabled?: boolean;
}) {
  function patch(
    partial: Partial<{
      name: string;
      car: string;
      driver_name: string;
      notes: string;
      weather: string;
      tires: string;
    }>,
  ) {
    onChange({
      name: partial.name ?? value.name,
      car: partial.car ?? value.car ?? "",
      driver_name: partial.driver_name ?? value.driver_name ?? "",
      notes: partial.notes ?? value.notes ?? "",
      weather: partial.weather ?? value.weather ?? "",
      tires: partial.tires ?? value.tires ?? "",
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-400">
        Edit session name, car, driver, weather, tires, and notes. Changes stay
        local until you tap Save.
      </p>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Name</span>
        <input
          disabled={disabled}
          value={value.name}
          onChange={(event) => patch({ name: event.target.value })}
          className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Car</span>
          <input
            disabled={disabled}
            value={value.car ?? ""}
            onChange={(event) => patch({ car: event.target.value })}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Driver</span>
          <input
            disabled={disabled}
            value={value.driver_name ?? ""}
            onChange={(event) => patch({ driver_name: event.target.value })}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Weather</span>
          <input
            disabled={disabled}
            value={value.weather ?? ""}
            placeholder="Dry, 18°C"
            onChange={(event) => patch({ weather: event.target.value })}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">Tires</span>
          <input
            disabled={disabled}
            value={value.tires ?? ""}
            placeholder="205 tires, stock sway"
            onChange={(event) => patch({ tires: event.target.value })}
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Notes</span>
        <textarea
          disabled={disabled}
          value={value.notes ?? ""}
          rows={3}
          onChange={(event) => patch({ notes: event.target.value })}
          className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      </label>
    </div>
  );
}
