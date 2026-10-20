"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

export type SessionToolTab = {
  id: string;
  label: string;
  content: ReactNode;
  /** Highlight when something needs attention (e.g. unsynced video). */
  badge?: string | null;
  /** Optional short icon glyph (emoji-free text/symbol). */
  icon?: string;
};

const DEFAULT_ICONS: Record<string, string> = {
  reparse: "↻",
  trim: "✂",
  sync: "⏯",
  exclude: "⊘",
  session: "✎",
  details: "✎",
  share: "⇧",
  notes: "¶",
  videos: "▶",
};

/**
 * Clearly visible labeled toolbar on the session page — icon + text buttons
 * (Re-parse, Trim, Sync video, Exclude, Edit details, Share). Real buttons,
 * not a hidden drawer toggle. Works on iPhone widths.
 *
 * When the parent already renders a session toolbar, pass `showButtons={false}`
 * so only the open panel content appears (no duplicate Trim/Sync/Exclude).
 */
export function SessionToolsPanel({
  tabs,
  defaultTab,
  defaultOpen = false,
  className,
  openRequest,
  toolbarActions,
  showButtons = true,
}: {
  tabs: SessionToolTab[];
  defaultTab?: string;
  /** Open the active tab panel on first paint (e.g. compare lap picker). */
  defaultOpen?: boolean;
  className?: string;
  /** External toolbar / parent asks to open a tab. */
  openRequest?: { tab: string; nonce: number } | null;
  /**
   * Extra always-visible labeled actions (e.g. Share, Re-parse) that may not
   * have a panel — shown in the same toolbar row.
   */
  toolbarActions?: Array<{
    id: string;
    label: string;
    icon?: string;
    onClick: () => void;
    badge?: string | null;
    emphasize?: boolean;
  }>;
  /**
   * When false, hide the tab/action button row (parent owns the toolbar).
   * Panel still opens via `openRequest`.
   */
  showButtons?: boolean;
}) {
  const baseId = useId();
  const usable = tabs.filter((tab) => tab.content != null);
  const [active, setActive] = useState(
    defaultTab && usable.some((t) => t.id === defaultTab)
      ? defaultTab
      : (usable[0]?.id ?? ""),
  );
  const [panelOpen, setPanelOpen] = useState(Boolean(defaultOpen));

  useEffect(() => {
    if (!openRequest?.tab) return;
    const id = openRequest.tab === "details" ? "session" : openRequest.tab;
    if (usable.some((t) => t.id === id)) {
      setActive(id);
      setPanelOpen(true);
    }
  }, [openRequest?.nonce, openRequest?.tab, usable]);

  if (!usable.length && !(toolbarActions?.length)) return null;

  const current = usable.find((tab) => tab.id === active) ?? usable[0];

  function selectTab(id: string) {
    setActive(id);
    setPanelOpen(true);
  }

  return (
    <div className={`shrink-0 ${className ?? ""}`}>
      {showButtons ? (
        <div
          role="toolbar"
          aria-label="Session tools"
          className="flex flex-wrap gap-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-1.5"
        >
          {usable.map((tab) => {
            const selected = panelOpen && tab.id === active;
            const icon = tab.icon ?? DEFAULT_ICONS[tab.id] ?? "·";
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectTab(tab.id)}
                className={`inline-flex min-h-10 min-w-[4.5rem] flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition sm:flex-none ${
                  selected
                    ? "bg-orange-500 text-black"
                    : "border border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:text-zinc-50"
                }`}
              >
                <span aria-hidden className="text-sm font-normal">
                  {icon}
                </span>
                <span>{tab.label}</span>
                {tab.badge ? (
                  <span className="rounded bg-black/20 px-1 font-mono text-[10px] normal-case tracking-normal">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
          {(toolbarActions ?? []).map((action) => {
            const icon = action.icon ?? DEFAULT_ICONS[action.id] ?? "·";
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.onClick}
                className={`inline-flex min-h-10 min-w-[4.5rem] flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] transition sm:flex-none ${
                  action.emphasize
                    ? "bg-orange-500 text-black hover:bg-orange-400"
                    : "border border-zinc-800 bg-zinc-900/80 text-zinc-200 hover:border-zinc-600 hover:text-zinc-50"
                }`}
              >
                <span aria-hidden className="text-sm font-normal">
                  {icon}
                </span>
                <span>{action.label}</span>
                {action.badge ? (
                  <span className="rounded bg-black/20 px-1 font-mono text-[10px] normal-case tracking-normal">
                    {action.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      {panelOpen && current ? (
        <div
          id={`${baseId}-panel`}
          role="region"
          aria-label={`${current.label} tools`}
          className="mt-2 rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              {current.label}
            </p>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            >
              Close
            </button>
          </div>
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
