"use client";

import {
  buildMailto,
  collectBugContext,
  contextLines,
  installErrorBuffer,
  reportText,
  type BugContext,
} from "@/lib/bug-report";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Mounted once in the root layout so errors are captured from first paint. */
export function BugReportCapture() {
  useEffect(() => {
    installErrorBuffer();
  }, []);
  return null;
}

function BugReportSheet({ controlMode, onClose }: { controlMode?: string; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [ctx] = useState<BugContext>(() => collectBugContext(controlMode));
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => prev?.focus?.();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(""), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(note, ctx));
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }

  // Games listen for keys on window (P, WASD, Esc): keep typing inside the sheet.
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-black/70"
      data-apex-bug-sheet-root="1"
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="apex-bug-title"
        data-apex-bug-sheet="1"
        className="max-h-[92dvh] w-full max-w-lg touch-manipulation overflow-y-auto border-t-2 border-zinc-700 bg-zinc-950 px-4 pt-4 text-zinc-100 outline-none [padding-bottom:max(1rem,env(safe-area-inset-bottom))] [padding-left:max(1rem,env(safe-area-inset-left))] [padding-right:max(1rem,env(safe-area-inset-right))] sm:mb-6 sm:border-2"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="apex-bug-title" className="text-lg font-semibold">
            Report a bug
          </h2>
          <button type="button" className="apex-btn apex-btn--ghost min-h-11 min-w-11" onClick={onClose} data-apex-bug-close="1">
            Close
          </button>
        </div>
        <label htmlFor="apex-bug-note" className="mt-3 block text-sm text-zinc-300">
          What went wrong?
        </label>
        <textarea
          id="apex-bug-note"
          data-apex-bug-note="1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={600}
          className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-base text-zinc-100"
        />
        <p className="mt-3 text-xs text-zinc-400">Sent with your report (nothing else is attached):</p>
        <pre
          data-apex-bug-context="1"
          className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-zinc-900 p-2 font-mono text-[11px] text-zinc-400"
        >
          {contextLines(ctx).join("\n")}
        </pre>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <a
            href={buildMailto(note, ctx)}
            data-apex-bug-email="1"
            className="apex-btn apex-btn--primary apex-btn--cta min-h-11 flex-1 justify-center"
          >
            Email Apex
          </a>
          <button
            type="button"
            data-apex-bug-copy="1"
            className="apex-btn min-h-11 flex-1 justify-center"
            onClick={copy}
          >
            Copy report
          </button>
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs text-zinc-300">
          {copied === "ok" ? "Copied" : copied === "fail" ? "Copy failed. Select the text and copy it by hand." : ""}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** "Report a bug" trigger + sheet. Use `className` to match the surrounding control style. */
export function BugReportButton({
  className = "apex-btn apex-btn--ghost min-h-11",
  controlMode,
  children = "Report a bug",
}: {
  className?: string;
  controlMode?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-apex-bug-report="1"
        aria-haspopup="dialog"
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open ? <BugReportSheet controlMode={controlMode} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
