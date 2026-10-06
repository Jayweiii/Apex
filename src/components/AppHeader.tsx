"use client";

import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium tracking-wide text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function AppHeader({
  email,
  local = false,
}: {
  email?: string;
  local?: boolean;
}) {
  return (
    <header className="flex items-center justify-between border-b border-zinc-900 px-6 py-4">
      <Link href="/" className="flex items-baseline gap-3">
        <span className="text-lg font-semibold tracking-[0.28em] text-zinc-50">
          APEX
        </span>
        <span className="hidden text-xs uppercase tracking-[0.22em] text-zinc-500 sm:inline">
          Lap times
        </span>
      </Link>
      <div className="flex items-center gap-3">
        {local ? (
          <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            This browser
          </span>
        ) : (
          <>
            {email ? (
              <span className="hidden max-w-[220px] truncate text-xs text-zinc-500 sm:block">
                {email}
              </span>
            ) : null}
            <SignOutButton />
          </>
        )}
      </div>
    </header>
  );
}
