"use client";

import { AccountSessions } from "@/components/AccountSessions";
import { ImportLocalSessions } from "@/components/ImportLocalSessions";
import { SavedComparisonsList } from "@/components/SavedComparisonsList";
import { SessionUpload } from "@/components/SessionUpload";
import { useState } from "react";

type Tab = "sessions" | "comparisons" | "upload";

/** Tabbed account layout to cut vertical scroll on desktop. */
export function AccountWorkbench() {
  const [tab, setTab] = useState<Tab>("sessions");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {(
          [
            { id: "sessions" as const, label: "Sessions" },
            { id: "comparisons" as const, label: "Comparisons" },
            { id: "upload" as const, label: "Upload" },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-10 rounded-lg px-3 text-xs uppercase tracking-[0.16em] ${
              tab === item.id
                ? "bg-zinc-100 text-zinc-900"
                : "border border-zinc-800 text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "sessions" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start">
          <ImportLocalSessions />
          <div className="max-h-[min(70vh,760px)] overflow-y-auto">
            <AccountSessions />
          </div>
        </div>
      ) : null}

      {tab === "comparisons" ? <SavedComparisonsList /> : null}

      {tab === "upload" ? <SessionUpload /> : null}
    </div>
  );
}
