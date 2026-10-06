"use client";

import { type KeyboardEvent, useEffect, useId, useState } from "react";

export type ComboOption = {
  id: string;
  label: string;
  hint?: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function SearchOrCreate({
  label,
  placeholder,
  options,
  valueId,
  onChange,
  onCreate,
}: {
  label: string;
  placeholder: string;
  options: ComboOption[];
  valueId: string;
  onChange: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const listId = useId();
  const selected = options.find((option) => option.id === valueId);
  const [text, setText] = useState(selected?.label ?? valueId);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!valueId) return;
    const match = options.find((option) => option.id === valueId);
    setText(match?.label ?? valueId);
  }, [valueId, options]);

  const needle = normalize(text.trim());
  const matches = options.filter((option) => {
    if (!needle) return true;
    return normalize(`${option.label} ${option.hint ?? ""}`).includes(needle);
  });
  const exact = options.some((option) => normalize(option.label) === needle);
  const showCreate = text.trim().length > 0 && !exact;
  const rowCount = matches.length + (showCreate ? 1 : 0);

  function choose(option: ComboOption) {
    setText(option.label);
    setOpen(false);
    onChange(option.id);
  }

  function create() {
    const name = text.trim();
    if (!name) return;
    setOpen(false);
    onCreate(name);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, Math.max(rowCount - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (showCreate && active >= matches.length) create();
      else if (matches[active]) choose(matches[active]);
      else if (showCreate) create();
    }
  }

  return (
    <div className="relative flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        required
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          setOpen(true);
          setActive(0);
          if (!selected || next !== selected.label) onChange("");
        }}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={onKeyDown}
        className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 py-1 shadow-xl"
        >
          {matches.map((option, index) => (
            <li key={option.id}>
              <button
                type="button"
                role="option"
                aria-selected={option.id === valueId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                className={`flex w-full flex-col items-start px-3 py-2 text-left hover:bg-zinc-900 ${
                  index === active ? "bg-zinc-900" : ""
                }`}
              >
                <span className="text-zinc-100">{option.label}</span>
                {option.hint ? (
                  <span className="text-xs text-zinc-500">{option.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
          {showCreate ? (
            <li>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={create}
                className={`w-full px-3 py-2 text-left text-orange-400 hover:bg-zinc-900 ${
                  active >= matches.length ? "bg-zinc-900" : ""
                }`}
              >
                Create “{text.trim()}”
              </button>
            </li>
          ) : null}
          {matches.length === 0 && !showCreate ? (
            <li className="px-3 py-2 text-zinc-500">No matches</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
