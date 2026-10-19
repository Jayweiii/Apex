"use client";

import { useId, useState, type ReactNode } from "react";

export type SessionToolTab = {
  id: string;
  label: string;
  content: ReactNode;
  /** Highlight when something needs attention (e.g. unsynced video). */
  badge?: string | null;
};

/**
 * Secondary session panels (sync, notes, GPS, trim, videos) live here so the
 * core map/video/telemetry dashboard stays one screen. Desktop: side drawer.
 * Mobile: compact tab strip above stacked content.
 */
export function SessionToolsPanel({
  tabs,
  defaultTab,
  className,
}: {
  tabs: SessionToolTab[];
  defaultTab?: string;
  className?: string;
}) {
  const baseId = useId();
  const usable = tabs.filter((tab) => tab.content != null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(
    defaultTab && usable.some((t) => t.id === defaultTab)
      ? defaultTab
      : (usable[0]?.id ?? ""),
  );

  if (!usable.length) return null;

  const current = usable.find((tab) => tab.id === active) ?? usable[0];

  return (
    <>
      {/* Mobile / narrow: inline collapsible tabs */}
      <div className={`lg:hidden ${className ?? ""}`}>
        <details className="rounded-xl border border-zinc-800/80 bg-zinc-950/40">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-[11px] uppercase tracking-[0.16em] text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
            Tools
            <span className="ml-2 font-normal normal-case tracking-normal text-zinc-600">
              sync · trim · notes · video
            </span>
          </summary>
          <div className="border-t border-zinc-900 px-2 pb-3 pt-2">
            <ToolTabs
              baseId={`${baseId}-m`}
              tabs={usable}
              active={current.id}
              onChange={setActive}
            />
            <div className="mt-2 max-h-[50vh] overflow-y-auto px-1">
              {current.content}
            </div>
          </div>
        </details>
      </div>

      {/* Desktop: edge button + slide-over drawer */}
      <div className={`hidden lg:block ${className ?? ""}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed right-3 top-1/2 z-30 -translate-y-1/2 rounded-l-lg border border-r-0 border-zinc-700 bg-zinc-950/95 px-2 py-3 text-[10px] uppercase tracking-[0.16em] text-zinc-300 shadow-lg hover:border-orange-500/50 hover:text-orange-300"
          aria-expanded={open}
          aria-controls={`${baseId}-drawer`}
        >
          Tools
          {usable.some((t) => t.badge) ? (
            <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-orange-400" />
          ) : null}
        </button>

        {open ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50"
            aria-label="Close tools"
            onClick={() => setOpen(false)}
          />
        ) : null}

        <aside
          id={`${baseId}-drawer`}
          className={`fixed right-0 top-0 z-50 flex h-full w-[min(100vw,22rem)] flex-col border-l border-zinc-800 bg-zinc-950 shadow-2xl transition-transform duration-200 ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
          aria-hidden={!open}
        >
          <div className="flex items-center justify-between border-b border-zinc-900 px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Session tools
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              Close
            </button>
          </div>
          <div className="border-b border-zinc-900 px-2 py-2">
            <ToolTabs
              baseId={`${baseId}-d`}
              tabs={usable}
              active={current.id}
              onChange={setActive}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {current.content}
          </div>
        </aside>
      </div>
    </>
  );
}

function ToolTabs({
  baseId,
  tabs,
  active,
  onChange,
}: {
  baseId: string;
  tabs: SessionToolTab[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Session tools"
      className="flex flex-wrap gap-1"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${baseId}-${tab.id}`}
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] uppercase tracking-[0.12em] transition ${
              selected
                ? "bg-orange-500/20 text-orange-200"
                : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="rounded bg-orange-500/30 px-1 font-mono text-[10px] normal-case tracking-normal text-orange-200">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
