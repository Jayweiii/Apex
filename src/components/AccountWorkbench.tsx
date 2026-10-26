"use client";

import { AccountSessions } from "@/components/AccountSessions";
import { ImportLocalSessions } from "@/components/ImportLocalSessions";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SavedComparisonsList } from "@/components/SavedComparisonsList";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";

const SessionUpload = dynamic(
  () =>
    import("@/components/SessionUpload").then((mod) => ({
      default: mod.SessionUpload,
    })),
  { ssr: false, loading: () => <PageSkeleton label="Loading upload…" rows={3} /> },
);

type Tab = "sessions" | "comparisons" | "upload";

/** Tabbed account layout to cut vertical scroll on desktop. */
export function AccountWorkbench() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-5">
      <div
        role="tablist"
        aria-label="Account sections"
        className="flex flex-wrap gap-2"
      >
        {(
          [
            { id: "sessions" as const, label: "My Sessions" },
            { id: "comparisons" as const, label: "Comparisons" },
            { id: "upload" as const, label: "Upload" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-busy={pending && tab !== item.id}
            onClick={() => startTransition(() => setTab(item.id))}
            className={`apex-btn ${tab === item.id ? "apex-btn--pressed" : ""}`}
          >
            {item.label}
            {pending && tab === item.id ? "…" : ""}
          </button>
        ))}
      </div>

      {tab === "sessions" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <ImportLocalSessions />
          <AccountSessions />
        </div>
      ) : null}

      {tab === "comparisons" ? <SavedComparisonsList /> : null}

      {tab === "upload" ? <SessionUpload /> : null}
    </div>
  );
}
