"use client";

import { SpeedUnitToggle } from "@/components/SpeedUnitToggle";
import { isAnonymousUser } from "@/lib/guest-auth";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

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
      aria-busy={busy}
      className="apex-btn"
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
  const menuId = useId();
  const [sessionEmail, setSessionEmail] = useState(email);
  const [guest, setGuest] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const signedIn = Boolean(sessionEmail) || guest;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-900/90 bg-zinc-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
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
                  aria-current={active ? "page" : undefined}
                  className={`apex-nav-link inline-flex min-h-10 items-center rounded-lg px-2.5 text-xs uppercase tracking-[0.16em] ${
                    active ? "apex-nav-link--active" : ""
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          {/* Wrapper hides desktop chrome on phones — .apex-btn {display:inline-flex}
              would override Tailwind `hidden` if applied on the same node. */}
          <div className="hidden items-center gap-1.5 sm:flex sm:gap-3">
            <SpeedUnitToggle />
            {signedIn ? (
              <>
                <Link
                  href="/account"
                  className="apex-btn apex-btn--ghost min-h-10"
                >
                  My Sessions
                </Link>
                <span className="hidden max-w-[180px] truncate text-xs text-zinc-500 lg:block">
                  {sessionEmail ?? (guest ? "Guest" : "")}
                </span>
                {guest ? (
                  <Link href="/login" className="apex-btn apex-btn--accent">
                    Keep sessions
                  </Link>
                ) : (
                  <SignOutButton />
                )}
              </>
            ) : (
              <Link href="/login" className="apex-btn">
                Sign in
              </Link>
            )}
          </div>
          <button
            type="button"
            className="apex-btn apex-btn--icon md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </div>
      <div
        id={menuId}
        hidden={!menuOpen}
        className="border-t border-zinc-900/80 px-3 py-2 md:hidden"
      >
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = navActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`apex-nav-link inline-flex min-h-10 items-center rounded-md px-3 text-xs uppercase tracking-[0.14em] ${
                  active ? "apex-nav-link--active" : ""
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-zinc-900/80 pt-2">
            <SpeedUnitToggle />
            {signedIn ? (
              <>
                <Link href="/account" className="apex-btn apex-btn--ghost">
                  My Sessions
                </Link>
                {guest ? (
                  <Link href="/login" className="apex-btn apex-btn--accent">
                    Keep sessions
                  </Link>
                ) : (
                  <SignOutButton />
                )}
              </>
            ) : (
              <Link href="/login" className="apex-btn">
                Sign in
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
