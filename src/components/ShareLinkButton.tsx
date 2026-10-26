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
    <button type="button" onClick={copy} className="apex-btn">
      {copied ? "Copied" : label}
    </button>
  );
}
