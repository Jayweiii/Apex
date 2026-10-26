"use client";

import { useLinkStatus } from "next/link";

/** Inline pending shimmer for Link children (useLinkStatus must be under Link). */
export function PendingNavHint({ label }: { label: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {pending ? (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-orange-400"
        />
      ) : null}
    </span>
  );
}
