"use client";

import { absoluteShareUrl } from "@/lib/session-meta";
import { useState } from "react";

export function ShareLinkButton({
  path,
  label = "Copy link",
}: {
  path: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = absoluteShareUrl(path);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex min-h-10 items-center rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
