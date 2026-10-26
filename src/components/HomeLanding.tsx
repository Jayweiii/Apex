"use client";

import { AppHeader } from "@/components/AppHeader";
import { HomeComparisonsGrid } from "@/components/HomeComparisonsGrid";
import { HomeTracksColumn } from "@/components/HomeTracksColumn";
import { SiteFooter } from "@/components/SiteFooter";
import { YourSessions } from "@/components/YourSessions";
import { isAnonymousUser } from "@/lib/guest-auth";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";

const HomeLiveExample = dynamic(
  () =>
    import("@/components/HomeLiveExample").then((mod) => ({
      default: mod.HomeLiveExample,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/40 px-4 text-sm text-zinc-500">
        Loading live example…
      </div>
    ),
  },
);

export function HomeLanding() {
  const [signedIn, setSignedIn] = useState(false);
  const [emailUser, setEmailUser] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled || !data.user) return;
        setSignedIn(true);
        setEmailUser(!isAnonymousUser(data.user));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-5 sm:gap-10 sm:px-6 sm:py-8">
        <section className="grid items-stretch gap-6 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col justify-center gap-5">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl lg:text-[2.65rem] lg:leading-tight">
              Compare your laps against anyone&apos;s
            </h1>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/upload"
                className="apex-btn apex-btn--primary apex-btn--cta"
              >
                Upload a session
              </Link>
              <Link href="/lap-comparisons" className="apex-btn apex-btn--cta">
                Browse lap comparisons
              </Link>
            </div>
            {emailUser ? (
              <p className="text-sm text-zinc-500">
                Welcome back —{" "}
                <Link
                  href="/account"
                  className="text-orange-400 hover:text-orange-300"
                >
                  open your sessions
                </Link>
                .
              </p>
            ) : (
              <p className="max-w-md text-sm leading-relaxed text-zinc-500">
                Guests can upload without an account. Add an email later to keep
                sessions across devices.
              </p>
            )}
          </div>
          <HomeLiveExample />
        </section>

        {signedIn ? (
          <div className="lg:hidden">
            <YourSessions />
          </div>
        ) : null}

        <section className="grid gap-8 lg:grid-cols-3 lg:gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium text-zinc-200">
                Recent comparisons
              </h2>
              <Link
                href="/lap-comparisons"
                className="text-[11px] uppercase tracking-[0.14em] text-zinc-600 hover:text-zinc-400"
              >
                All
              </Link>
            </div>
            <HomeComparisonsGrid />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-200">Tracks</h2>
            <HomeTracksColumn />
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-200">How it works</h2>
            <ol className="space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-4 text-sm text-zinc-400">
              <li className="flex gap-3">
                <span className="font-mono text-xs text-orange-400/90">1</span>
                <span>
                  Import TrackAddict, GoPro, VBO, GPX, or Dragy telemetry.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-orange-400/90">2</span>
                <span>
                  Compare up to four laps on a satellite map with delta charts.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-orange-400/90">3</span>
                <span>
                  Sync YouTube onboards and share a public comparison link.
                </span>
              </li>
            </ol>
            {signedIn ? (
              <div className="hidden lg:block">
                <YourSessions />
              </div>
            ) : null}
          </div>
        </section>
      </main>
      <SiteFooter signedIn={signedIn} />
    </>
  );
}
