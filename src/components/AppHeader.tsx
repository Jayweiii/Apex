"use client";

import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
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

export function AppHeader({ email }: { email?: string }) {
  const configured = hasSupabaseConfig();
  const [sessionEmail, setSessionEmail] = useState(email);

  useEffect(() => {
    if (!configured || email) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setSessionEmail(data.user?.email ?? undefined);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [configured, email]);

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
        {sessionEmail ? (
          <>
            <Link
              href="/account"
              className="text-xs uppercase tracking-[0.18em] text-zinc-400 hover:text-zinc-200"
            >
              Account
            </Link>
            <span className="hidden max-w-[220px] truncate text-xs text-zinc-500 sm:block">
              {sessionEmail}
            </span>
            <SignOutButton />
          </>
        ) : (
          <Link
            href="/login"
            className="rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium tracking-wide text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
