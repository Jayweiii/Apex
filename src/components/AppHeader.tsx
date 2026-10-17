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
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-zinc-900/90 bg-zinc-950/85 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
      <Link href="/" className="flex min-h-10 items-baseline gap-3">
        <span className="text-lg font-semibold tracking-[0.28em] text-zinc-50">
          APEX
        </span>
        <span className="hidden text-xs uppercase tracking-[0.22em] text-zinc-500 sm:inline">
          Lap times
        </span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/youtube"
          className="hidden min-h-10 items-center text-xs uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300 sm:inline-flex"
        >
          YouTube
        </Link>
        <Link
          href="/friends"
          className="hidden min-h-10 items-center text-xs uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300 sm:inline-flex"
        >
          Friends
        </Link>
        {sessionEmail ? (
          <>
            <Link
              href="/account"
              className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.18em] text-zinc-400 hover:text-zinc-200"
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
            className="inline-flex min-h-10 items-center rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium tracking-wide text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
