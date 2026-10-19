"use client";

import { isAnonymousUser } from "@/lib/guest-auth";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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

const NAV = [
  { href: "/", label: "Home" },
  { href: "/upload", label: "Upload" },
  { href: "/lap-comparisons", label: "Lap Comparisons" },
  { href: "/tracks", label: "Tracks" },
] as const;

function navActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppHeader({ email }: { email?: string }) {
  const configured = hasSupabaseConfig();
  const pathname = usePathname() ?? "/";
  const [sessionEmail, setSessionEmail] = useState(email);
  const [guest, setGuest] = useState(false);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return;
        setSessionEmail(data.user?.email ?? email);
        setGuest(isAnonymousUser(data.user));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [configured, email]);

  const signedIn = Boolean(sessionEmail) || guest;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-900/90 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Link href="/" className="flex min-h-10 shrink-0 items-baseline gap-2">
            <span className="text-lg font-semibold tracking-[0.28em] text-zinc-50">
              APEX
            </span>
          </Link>
          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 md:flex"
          >
            {NAV.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`inline-flex min-h-10 items-center rounded-lg px-2.5 text-xs uppercase tracking-[0.16em] transition ${
                    active
                      ? "text-orange-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {signedIn ? (
            <>
              <Link
                href="/account"
                className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-200"
              >
                Sessions
              </Link>
              <span className="hidden max-w-[180px] truncate text-xs text-zinc-500 lg:block">
                {sessionEmail ?? (guest ? "Guest" : "")}
              </span>
              {guest ? (
                <Link
                  href="/login"
                  className="inline-flex min-h-10 items-center rounded-full border border-zinc-800 px-3 py-1.5 text-xs font-medium tracking-wide text-orange-300 transition hover:border-orange-500/50"
                >
                  Keep sessions
                </Link>
              ) : (
                <SignOutButton />
              )}
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
      </div>
      <nav
        aria-label="Mobile"
        className="flex gap-1 overflow-x-auto border-t border-zinc-900/80 px-3 py-1.5 md:hidden"
      >
        {NAV.map((item) => {
          const active = navActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex min-h-9 shrink-0 items-center rounded-md px-2.5 text-[11px] uppercase tracking-[0.14em] ${
                active ? "text-orange-300" : "text-zinc-500"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
