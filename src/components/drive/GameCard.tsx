"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A featured game on the Drive page: a short looping clip of the real game
 * (played only while on screen, and never for people who asked for reduced
 * motion: they see the still), what it is, your best, and one big way in.
 * The whole card is the link, so it is an easy target on a phone.
 */
export function GameCard({
  href,
  clip,
  accent,
  eyebrow,
  title,
  titleClass = "",
  blurb,
  chips,
  stat,
  cta,
  entry,
}: {
  href: string;
  /** Files in /public/games: `${clip}-preview.mp4|webm` and `${clip}-poster.jpg`. */
  clip: string;
  /** Accent colour for the eyebrow, chips and button. */
  accent: string;
  eyebrow: string;
  title: string;
  titleClass?: string;
  blurb: string;
  chips: string[];
  /** Your best, or a nudge to set one. */
  stat: ReactNode;
  cta: string;
  /** data-* hook kept for tests and analytics, e.g. "apex-sim-entry". */
  entry: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) void v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  return (
    <Link
      href={href}
      prefetch={false}
      {...{ [`data-${entry}`]: "1" }}
      className="apex-gamecard px-panel group relative flex flex-col overflow-hidden text-left"
      style={{ ["--accent" as string]: accent }}
    >
      <div className="relative aspect-video w-full overflow-hidden border-b-2 border-[var(--px-edge)] bg-zinc-900">
        <video
          ref={video}
          className="absolute inset-0 h-full w-full object-cover"
          poster={`/games/${clip}-poster.jpg`}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden
          tabIndex={-1}
          data-game-preview={clip}
        >
          <source src={`/games/${clip}-preview.webm`} type="video/webm" />
          <source src={`/games/${clip}-preview.mp4`} type="video/mp4" />
        </video>
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#151823] via-[#151823]/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
          <p className="px-label" style={{ color: accent }}>
            {eyebrow}
          </p>
          <h2 className={`px-title mt-1 text-2xl leading-tight text-zinc-50 [text-shadow:2px_2px_0_#07080c] sm:text-3xl ${titleClass}`}>{title}</h2>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 pt-3 sm:p-5 sm:pt-3">
        <p className="text-sm text-zinc-300">{blurb}</p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Highlights">
          {chips.map((c) => (
            <li key={c} className="apex-gamecard__chip px-label px-2 py-1">
              {c}
            </li>
          ))}
        </ul>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="text-xs text-zinc-400" data-game-stat={clip}>
            {stat}
          </p>
          <span className="apex-gamecard__cta px-label inline-flex min-h-11 items-center px-4">
            {cta} <span aria-hidden className="ml-1.5">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
