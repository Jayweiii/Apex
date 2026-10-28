"use client";

import { AccountSessions } from "@/components/AccountSessions";
import { FriendsPanel } from "@/components/FriendsPanel";
import { ImportLocalSessions } from "@/components/ImportLocalSessions";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SavedComparisonsList } from "@/components/SavedComparisonsList";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";

const SessionUpload = dynamic(
  () =>
    import("@/components/SessionUpload").then((mod) => ({
      default: mod.SessionUpload,
    })),
  { ssr: false, loading: () => <PageSkeleton label="Loading upload…" rows={3} /> },
);

type Tab = "sessions" | "comparisons" | "friends" | "upload";

/** Tabbed account layout to cut vertical scroll on desktop. */
export function AccountWorkbench() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setUserId(data.user?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            { id: "friends" as const, label: "Friends" },
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

      {tab === "friends" ? (
        userId ? (
          <FriendsPanel userId={userId} />
        ) : (
          <p className="text-sm text-zinc-500">Sign in to manage friends.</p>
        )
      ) : null}

      {tab === "upload" ? <SessionUpload /> : null}
    </div>
  );
}
