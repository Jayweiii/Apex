/** Apex Rush garage: what a kart looks like and how that changes its handling. */
import { BASE_STATS, type KartStats } from "./kart";

export type BodyId = "classic" | "wedge" | "buggy" | "bubble";
export type WheelId = "slick" | "chunky" | "drift";

export type KartLook = {
  body: BodyId;
  wheels: WheelId;
  paint: string;
  accent: string;
  helmet: string;
  number: number;
};

type Part<T extends string> = { id: T; name: string; blurb: string; speed: number; accel: number; handling: number; drift: number };

/** Stat points are −2 … +2 around the base kart. */
export const BODIES: Array<Part<BodyId>> = [
  { id: "classic", name: "Classic", blurb: "Balanced all-rounder", speed: 0, accel: 0, handling: 0, drift: 0 },
  { id: "wedge", name: "Wedge", blurb: "Low and fast, slow to launch", speed: 2, accel: -1, handling: -1, drift: 0 },
  { id: "buggy", name: "Buggy", blurb: "Punchy off the line", speed: -1, accel: 2, handling: 0, drift: -1 },
  { id: "bubble", name: "Bubble", blurb: "Light, loves to slide", speed: -1, accel: 0, handling: 1, drift: 2 },
];

export const WHEELS: Array<Part<WheelId>> = [
  { id: "slick", name: "Slicks", blurb: "Top speed", speed: 1, accel: 0, handling: 0, drift: -1 },
  { id: "chunky", name: "Chunky", blurb: "Grip and launch", speed: -1, accel: 1, handling: 1, drift: 0 },
  { id: "drift", name: "Drift", blurb: "Faster mini-turbos", speed: 0, accel: 0, handling: -1, drift: 2 },
];

export const PAINTS = ["#ef233c", "#ff8c42", "#f6c343", "#70e000", "#2ec4b6", "#4cc9f0", "#4361ee", "#b388ff", "#f72585", "#f8f9fa", "#343a40"];

export const DEFAULT_LOOK: KartLook = { body: "classic", wheels: "slick", paint: "#ef233c", accent: "#f8f9fa", helmet: "#f6c343", number: 7 };

export type StatPoints = { speed: number; accel: number; handling: number; drift: number };

export function statPoints(look: KartLook): StatPoints {
  const b = BODIES.find((p) => p.id === look.body) ?? BODIES[0]!;
  const w = WHEELS.find((p) => p.id === look.wheels) ?? WHEELS[0]!;
  return { speed: b.speed + w.speed, accel: b.accel + w.accel, handling: b.handling + w.handling, drift: b.drift + w.drift };
}

export function statsFor(look: KartLook): KartStats {
  const p = statPoints(look);
  return {
    top: BASE_STATS.top * (1 + p.speed * 0.022),
    accel: 1 + p.accel * 0.09,
    handling: 1 + p.handling * 0.06,
    drift: 1 + p.drift * 0.12,
    weight: look.body === "bubble" ? 0.85 : look.body === "wedge" ? 1.1 : 1,
  };
}

const KEY = "apex.rush.kart";
const HEX = /^#[0-9a-f]{6}$/i;

export function loadLook(): KartLook {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_LOOK };
    const v = JSON.parse(raw) as Partial<KartLook>;
    return {
      body: BODIES.some((b) => b.id === v.body) ? v.body! : DEFAULT_LOOK.body,
      wheels: WHEELS.some((w) => w.id === v.wheels) ? v.wheels! : DEFAULT_LOOK.wheels,
      paint: typeof v.paint === "string" && HEX.test(v.paint) ? v.paint : DEFAULT_LOOK.paint,
      accent: typeof v.accent === "string" && HEX.test(v.accent) ? v.accent : DEFAULT_LOOK.accent,
      helmet: typeof v.helmet === "string" && HEX.test(v.helmet) ? v.helmet : DEFAULT_LOOK.helmet,
      number: typeof v.number === "number" && v.number >= 0 && v.number <= 99 ? Math.round(v.number) : DEFAULT_LOOK.number,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function saveLook(look: KartLook): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // Not saved; the look still applies for this visit.
  }
}
