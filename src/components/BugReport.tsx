"use client";

import {
  buildMailto,
  collectContext,
  formatContext,
  formatReport,
  installErrorBuffer,
  type BugContext,
} from "@/lib/bug-report";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Mount once in the root layout so errors are captured before a report opens. */
export function BugReportBoot() {
  useEffect(() => installErrorBuffer(), []);
  return null;
}

/** Stop game/page handlers (stick, pause hotkeys) from seeing sheet input. */
const stop = (e: { stopPropagation: () => void; nativeEvent?: Event }) => {
  e.stopPropagation();
  e.nativeEvent?.stopPropagation();
};

function BugReportSheet({ controls, onClose }: { controls?: string; onClose: () => void }) {
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [ctx] = useState<BugContext>(() => collectContext(controls));
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    installErrorBuffer();
    panel.current?.focus();
    return () => window.clearTimeout(copyTimer.current);
  }, []);

  async function copy() {
    const text = formatReport(note, ctx);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 sm:items-center"
      data-bug-report-sheet="1"
      onPointerDown={stop}
      onPointerUp={stop}
      onTouchStart={stop}
      onTouchMove={stop}
      onKeyDown={(e) => {
        stop(e);
        if (e.key === "Escape") onClose();
      }}
      onKeyUp={stop}
      onClick={(e) => {
        stop(e);
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-zinc-700 bg-zinc-950 p-4 text-zinc-100 outline-none sm:rounded-2xl"
        style={{
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            Report a bug
          </h2>
          <button type="button" className="apex-btn min-h-11" data-bug-report-close="1" onClick={onClose}>
            Close
          </button>
        </div>
        <label htmlFor={noteId} className="mt-3 block text-sm text-zinc-300">
          What went wrong?
        </label>
        <textarea
          id={noteId}
          data-bug-report-note="1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-base text-zinc-100"
        />
        <p className="mt-3 text-xs text-zinc-400">Attached automatically (no logins, cookies or saved data):</p>
        <pre
          data-bug-report-context="1"
          className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] leading-snug text-zinc-400"
        >
          {formatContext(ctx)}
        </pre>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a
            href={buildMailto(note, ctx)}
            data-bug-report-email="1"
            className="apex-btn apex-btn--primary min-h-11"
          >
            Email Apex
          </a>
          <button type="button" data-bug-report-copy="1" className="apex-btn min-h-11" onClick={copy}>
            Copy report
          </button>
        </div>
        <p role="status" aria-live="polite" className="mt-2 h-4 text-center text-xs text-lime-300" data-bug-report-copied={copied ? "1" : undefined}>
          {copied ? "Copied" : ""}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** A "Report a bug" trigger plus its sheet. Style it with `className`. */
export function BugReportButton({
  className,
  controls,
  children = "Report a bug",
  dataAttr,
}: {
  className?: string;
  /** Control mode to include in the report (games). */
  controls?: string;
  children?: ReactNode;
  dataAttr?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className}
        data-bug-report-open={dataAttr ?? "1"}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <BugReportSheet controls={controls} onClose={close} /> : null}
    </>
  );
}
