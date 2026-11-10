"use client";

import { AppHeader } from "@/components/AppHeader";
import { HomeComparisonsGrid } from "@/components/HomeComparisonsGrid";
import { HomeTracksColumn } from "@/components/HomeTracksColumn";
import { PixelLapScene } from "@/components/pixel/PixelLapScene";
import { SiteFooter } from "@/components/SiteFooter";
import { YourSessions } from "@/components/YourSessions";
import type { ComparisonRow } from "@/lib/comparisons";
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
      <div className="px-label flex h-full min-h-[280px] items-center justify-center border-2 border-dashed border-zinc-800 bg-zinc-950/40 px-4 text-zinc-500">
        Loading live example…
      </div>
    ),
  },
);

export function HomeLanding({
  initialComparisons = null,
}: {
  initialComparisons?: ComparisonRow[] | null;
} = {}) {
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
      <main
        id="main-content"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-5 sm:gap-10 sm:px-6 sm:py-8"
      >
        {/* Hero: the pitch, with two pixel cars doing what the site does. */}
        <section className="px-panel overflow-hidden">
          <div className="grid items-center gap-5 p-4 sm:p-6 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:p-8">
            <div className="flex flex-col gap-4">
              <p className="px-label text-orange-400">Lap telemetry · in your browser</p>
              <h1 className="text-4xl font-bold leading-[1.05] text-zinc-50 sm:text-5xl">
                Compare your laps against anyone&apos;s
              </h1>
              <p className="max-w-md text-sm leading-relaxed text-zinc-400">
                Drop in a log from your phone, GoPro or data logger. Apex finds the laps, lines them up on the
                map and shows where the time went.
              </p>
              {/* Phones: equal full-width CTAs; sm+: side by side. */}
              <div className="grid gap-3 sm:flex sm:flex-wrap">
                <Link
                  href="/upload"
                  className="apex-btn apex-btn--primary apex-btn--cta w-full sm:w-auto"
                >
                  Upload a session
                </Link>
                <Link
                  href="/lap-comparisons"
                  className="apex-btn apex-btn--cta w-full sm:w-auto"
                >
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
                <p className="max-w-md text-xs leading-relaxed text-zinc-500">
                  Guests can upload without an account. Add an email later to keep
                  sessions across devices.
                </p>
              )}
            </div>
            <div className="border-2 border-zinc-800 bg-zinc-950">
              <PixelLapScene />
              <div className="px-label flex flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-zinc-800 px-3 py-2 text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className="block h-2 w-2 bg-[#4cc9f0]" /> Reference
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="block h-2 w-2 bg-orange-500" /> You
                </span>
                <span className="ml-auto text-zinc-600">Gap · Speed</span>
              </div>
            </div>
          </div>
          <div className="px-checker" aria-hidden />
        </section>

        <ul className="px-label flex flex-wrap gap-2 text-zinc-400" aria-label="Supported formats">
          {FORMATS.map((f) => (
            <li key={f} className="border-2 border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              {f}
            </li>
          ))}
        </ul>

        {signedIn ? (
          <div className="lg:hidden">
            <YourSessions />
          </div>
        ) : null}

        <section className="flex flex-col gap-3">
          <SectionTitle n="01" title="A real comparison, live" />
          <HomeLiveExample />
        </section>

        <section className="grid gap-8 lg:grid-cols-3 lg:gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-2">
              <SectionTitle n="02" title="Recent comparisons" />
              <Link
                href="/lap-comparisons"
                className="apex-hit px-label text-zinc-500 hover:text-zinc-300"
              >
                All →
              </Link>
            </div>
            <HomeComparisonsGrid initialComparisons={initialComparisons} />
          </div>

          <div className="flex flex-col gap-3">
            <SectionTitle n="03" title="Tracks" />
            <HomeTracksColumn />
          </div>

          <div className="flex flex-col gap-3">
            <SectionTitle n="04" title="How it works" />
            <ol className="px-panel px-panel--flat space-y-4 px-4 py-4 text-sm text-zinc-400">
              {STEPS.map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="px-label flex h-7 w-7 shrink-0 items-center justify-center bg-orange-500 font-bold text-black">
                    {i + 1}
                  </span>
                  <span className="pt-1">{step}</span>
                </li>
              ))}
            </ol>
            {signedIn ? (
              <div className="hidden lg:block">
                <YourSessions />
              </div>
            ) : null}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle n="05" title="Arcade" />
          <div className="grid gap-3 sm:grid-cols-3">
            {ARCADE.map((game) => (
              <Link
                key={game.href}
                href={game.href}
                className="px-panel flex min-h-24 flex-col justify-between gap-2 p-4 hover:border-zinc-500 active:translate-x-0.5 active:translate-y-0.5"
              >
                <span className="px-title text-xl font-bold" style={{ color: game.color }}>
                  {game.name}
                </span>
                <span className="text-xs text-zinc-500">{game.blurb}</span>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter signedIn={signedIn} />
    </>
  );
}

const FORMATS = ["TrackAddict", "GoPro", "VBO", "GPX", "Dragy", "YouTube onboard"];

const STEPS = [
  "Import TrackAddict, GoPro, VBO, GPX, or Dragy telemetry.",
  "Compare up to four laps on a satellite map with delta charts.",
  "Sync YouTube onboards and share a public comparison link.",
];

const ARCADE = [
  { href: "/rush", name: "Apex Rush", blurb: "3D pixel karts on four real circuits. Drift, boost, race a real lap's ghost.", color: "#ffd60a" },
  { href: "/kart2", name: "Apex Kart", blurb: "Stick-to-steer karting with drift boosts and a telemetry ghost.", color: "#f97316" },
  { href: "/drive", name: "Drive", blurb: "Hot-lap the tracks you've uploaded in a 3D car.", color: "#4cc9f0" },
];

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <h2 className="flex items-baseline gap-2 text-xl font-bold text-zinc-100">
      <span className="px-label text-orange-500">{n}</span>
      {title}
    </h2>
  );
}
