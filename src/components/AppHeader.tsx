"use client";

import { PendingNavHint } from "@/components/PendingNavHint";
import { PixelMark } from "@/components/pixel/PixelMark";
import { SpeedUnitToggle } from "@/components/SpeedUnitToggle";
import { isAnonymousUser } from "@/lib/guest-auth";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function signOut() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    startTransition(() => {
      router.replace("/");
      router.refresh();
    });
  }

  const waiting = busy || pending;
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={waiting}
      aria-busy={waiting}
      className="apex-btn"
    >
      {waiting ? "Signing out…" : "Sign out"}
    </button>
  );
}

const NAV = [
  { href: "/", label: "Home", apex: "home" },
  { href: "/upload", label: "Upload", apex: "upload" },
  { href: "/lap-comparisons", label: "Lap Comparisons", apex: "compare" },
  { href: "/tracks", label: "Tracks", apex: "session" },
  { href: "/drive", label: "Drive", apex: "drive" },
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
    <header
      data-apex-header="1"
      className="sticky top-0 z-40 border-b-2 border-zinc-800 bg-zinc-950"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Link
            href="/"
            data-apex-nav="brand"
            className="flex min-h-10 shrink-0 items-center gap-2"
          >
            <PixelMark size={26} />
            <span className="px-title text-xl font-bold tracking-[0.12em] text-zinc-50">
              APEX
            </span>
          </Link>
          <nav
            aria-label="Primary"
            data-apex-nav-desktop="1"
            className="hidden items-center gap-1 md:flex"
          >
            {NAV.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  data-apex-nav={item.apex}
                  aria-current={active ? "page" : undefined}
                  className={`apex-nav-link inline-flex min-h-10 items-center px-2.5 text-xs uppercase tracking-[0.06em] ${
                    active ? "apex-nav-link--active" : ""
                  }`}
                >
                  <PendingNavHint label={item.label} />
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
            data-apex-nav-menu="1"
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
        data-apex-nav-drawer="1"
        className="absolute inset-x-0 top-full z-50 border-b-2 border-t-2 border-zinc-800 bg-zinc-950 px-3 py-2 shadow-[0_6px_0_#07080c] md:hidden"
      >
        <nav
          aria-label="Mobile"
          data-apex-nav-mobile="1"
          className="flex flex-col gap-1"
        >
          {NAV.map((item) => {
            const active = navActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                data-apex-nav={item.apex}
                aria-current={active ? "page" : undefined}
                className={`apex-nav-link inline-flex min-h-11 items-center px-3 text-sm uppercase tracking-[0.06em] ${
                  active ? "apex-nav-link--active" : ""
                }`}
              >
                <PendingNavHint label={item.label} />
              </Link>
            );
          })}
        </nav>
        {/*
          Speed units live outside <nav> links so mph|km/h remounts cannot
          hit a sibling Link (Playwright "page changed" / missed taps).
          stopPropagation keeps the drawer open across unit writes.
        */}
        <div
          className="mt-2 flex flex-wrap items-center gap-3 border-t-2 border-dashed border-zinc-800 pt-3"
          data-apex-nav-utils="1"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
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
      </div>
    </header>
  );
}
