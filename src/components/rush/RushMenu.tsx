"use client";

import { BODIES, PAINTS, statPoints, WHEELS, type KartLook } from "@/lib/rush/garage";
import { loadBest } from "@/lib/rush/ghost";
import { RUSH_LEVELS, type RushLevel } from "@/lib/rush/levels";
import type { RushMode } from "@/lib/rush/race";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createKartPreview, type KartPreview } from "./preview";
import { formatRushTime } from "./RushRace";

type Tab = "race" | "garage";

/** Tiny outline of the real circuit, drawn from its baked centreline. */
function TrackOutline({ level, active }: { level: RushLevel; active: boolean }) {
  const path = useMemo(() => {
    const pts = level.data.pts;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]!);
      x1 = Math.max(x1, p[0]!);
      y0 = Math.min(y0, p[1]!);
      y1 = Math.max(y1, p[1]!);
    }
    const s = 52 / Math.max(x1 - x0, y1 - y0);
    const ox = (64 - (x1 - x0) * s) / 2;
    const oy = (64 - (y1 - y0) * s) / 2;
    return (
      pts
        .filter((_, i) => i % 2 === 0)
        .map((p, i) => `${i === 0 ? "M" : "L"}${(ox + (p[0]! - x0) * s).toFixed(1)} ${(64 - oy - (p[1]! - y0) * s).toFixed(1)}`)
        .join(" ") + " Z"
    );
  }, [level]);
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" aria-hidden shapeRendering="crispEdges">
      <path d={path} fill="none" stroke="#14151a" strokeWidth="6" strokeLinejoin="round" />
      <path d={path} fill="none" stroke={active ? "#ffd60a" : "#adb5bd"} strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function StatBar({ label, points }: { label: string; points: number }) {
  // −3 … +4 points → 1 … 8 blocks.
  const filled = Math.max(1, Math.min(8, points + 4));
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-20 shrink-0 text-[#adb5bd]">{label}</span>
      <span className="flex gap-0.5" role="img" aria-label={`${label} ${filled} of 8`}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className={`block h-3 w-3 ${i < filled ? "bg-[#ffd60a]" : "bg-[#343a40]"}`} />
        ))}
      </span>
    </div>
  );
}

function Swatches({ label, value, onPick }: { label: string; value: string; onPick: (hex: string) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-[#adb5bd]">{label}</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {PAINTS.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={value === hex}
            aria-label={hex}
            className="rush-swatch"
            style={{ background: hex }}
            onClick={() => onPick(hex)}
          />
        ))}
      </div>
    </div>
  );
}

export function RushMenu({
  look,
  onLook,
  levelId,
  onLevel,
  mode,
  onMode,
  onStart,
}: {
  look: KartLook;
  onLook: (look: KartLook) => void;
  levelId: string;
  onLevel: (id: string) => void;
  mode: RushMode;
  onMode: (mode: RushMode) => void;
  onStart: () => void;
}) {
  const [tab, setTab] = useState<Tab>("race");
  // Client-only component: best laps can be read straight from storage.
  const [bests] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    for (const l of RUSH_LEVELS) {
      const best = loadBest(l.id);
      if (best) next[l.id] = best.lapMs;
    }
    return next;
  });
  const previewCanvas = useRef<HTMLCanvasElement | null>(null);
  const preview = useRef<KartPreview | null>(null);
  const lookRef = useRef(look);

  useEffect(() => {
    const canvas = previewCanvas.current;
    if (!canvas) return;
    try {
      preview.current = createKartPreview(canvas, lookRef.current);
    } catch {
      // No WebGL: the menu works without the turning kart.
      canvas.hidden = true;
    }
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, []);

  useEffect(() => {
    lookRef.current = look;
    preview.current?.setLook(look);
  }, [look]);

  const points = statPoints(look);
  const level = RUSH_LEVELS.find((l) => l.id === levelId) ?? RUSH_LEVELS[0]!;

  return (
    <div className="rush mx-auto w-full max-w-3xl px-4 pb-10 pt-6 text-[#f8f9fa]" data-rush-menu="1">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="rush-title">
            APEX
            <br />
            RUSH
          </h1>
          <p className="mt-4 text-xs text-[#adb5bd]">PIXEL KART RACING ON REAL CIRCUITS</p>
        </div>
        <div className="relative h-32 w-44 shrink-0 sm:h-40 sm:w-60">
          <canvas ref={previewCanvas} className="rush-canvas h-full w-full" aria-label="Your kart" />
        </div>
      </div>

      <div className="mt-5 flex gap-2" role="tablist" aria-label="Apex Rush">
        {(["race", "garage"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-rush-tab={t}
            className={`rush-btn flex-1 ${tab === t ? "rush-btn--go" : "rush-btn--ghost"}`}
            onClick={() => setTab(t)}
          >
            {t === "race" ? "Race" : "Garage"}
          </button>
        ))}
      </div>

      {tab === "race" ? (
        <div role="tabpanel" className="mt-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="rush-seg" role="group" aria-label="Mode">
              <button type="button" aria-pressed={mode === "gp"} data-rush-mode="gp" onClick={() => onMode("gp")}>
                Grand Prix
              </button>
              <button type="button" aria-pressed={mode === "tt"} data-rush-mode="tt" onClick={() => onMode("tt")}>
                Time Trial
              </button>
            </div>
            <p className="text-[11px] text-[#adb5bd]">
              {mode === "gp" ? "RACE 5 RIVALS FROM THE BACK OF THE GRID" : "CHASE A GHOST OF A REAL LAP, THEN YOUR OWN"}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Track">
            {RUSH_LEVELS.map((l) => {
              const active = l.id === levelId;
              const relief = Math.round(Math.max(...l.data.pts.map((p) => p[2] ?? 0)));
              return (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-rush-track={l.id}
                  className="rush-card"
                  onClick={() => onLevel(l.id)}
                >
                  <span className="flex items-center gap-3">
                    <TrackOutline level={l} active={active} />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{l.data.name.toUpperCase()}</span>
                      <span className="block text-[11px] text-[#adb5bd]">{l.tagline}</span>
                      <span className="mt-1 block text-[11px] text-[#ffd60a]">
                        {(l.data.lengthM / 1000).toFixed(1)} KM REAL · {relief} M OF CLIMB · {"★".repeat(l.difficulty)}
                      </span>
                      <span className="block text-[11px] text-[#4cc9f0]">{bests[l.id] ? `YOUR BEST ${formatRushTime(bests[l.id]!)}` : "NO LAP SET"}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <button type="button" className="rush-btn rush-btn--go w-full text-lg" data-rush-start="1" onClick={onStart}>
            Race {level.data.name} →
          </button>
          <p className="text-[10px] leading-relaxed text-[#6c757d]">
            Tracks are shrunk to kart size from real outlines and real elevation. {level.data.sources?.join(" · ")}. Times here are game
            times and never count as real laps.
          </p>
        </div>
      ) : (
        <div role="tabpanel" className="mt-5 space-y-5" data-rush-garage="1">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-[11px] text-[#adb5bd]">BODY</p>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Body">
                {BODIES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={look.body === b.id}
                    data-rush-body={b.id}
                    className="rush-card"
                    onClick={() => onLook({ ...look, body: b.id })}
                  >
                    <span className="block text-sm font-bold">{b.name.toUpperCase()}</span>
                    <span className="block text-[10px] text-[#adb5bd]">{b.blurb}</span>
                  </button>
                ))}
              </div>
              <p className="mb-1 mt-4 text-[11px] text-[#adb5bd]">WHEELS</p>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Wheels">
                {WHEELS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={look.wheels === w.id}
                    data-rush-wheels={w.id}
                    className="rush-card"
                    onClick={() => onLook({ ...look, wheels: w.id })}
                  >
                    <span className="block text-xs font-bold">{w.name.toUpperCase()}</span>
                    <span className="block text-[10px] text-[#adb5bd]">{w.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] text-[#adb5bd]">STATS</p>
              <StatBar label="SPEED" points={points.speed} />
              <StatBar label="LAUNCH" points={points.accel} />
              <StatBar label="GRIP" points={points.handling} />
              <StatBar label="DRIFT" points={points.drift} />
            </div>
          </div>
          <Swatches label="PAINT" value={look.paint} onPick={(paint) => onLook({ ...look, paint })} />
          <Swatches label="TRIM AND SUIT" value={look.accent} onPick={(accent) => onLook({ ...look, accent })} />
          <Swatches label="HELMET" value={look.helmet} onPick={(helmet) => onLook({ ...look, helmet })} />
          <button type="button" className="rush-btn rush-btn--go w-full" onClick={() => setTab("race")}>
            Done
          </button>
        </div>
      )}

      <p className="mt-6 text-center text-[11px]">
        <Link href="/drive" className="apex-hit text-[#adb5bd] underline">
          BACK TO DRIVE
        </Link>
      </p>
    </div>
  );
}
