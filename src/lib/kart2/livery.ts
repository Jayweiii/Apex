export const KART2_LIVERY_KEY = "apex.kart2.livery";

export const KART_COLORS = [
  { id: "apex", hex: "#ff5a1f", name: "Apex orange" },
  { id: "sun", hex: "#ffd23f", name: "Sun" },
  { id: "sky", hex: "#3ec1ff", name: "Sky" },
  { id: "lime", hex: "#7dff6b", name: "Lime" },
  { id: "pink", hex: "#ff4d8d", name: "Pink" },
  { id: "ivory", hex: "#f4f1ea", name: "Ivory" },
  { id: "ink", hex: "#1c1a22", name: "Ink" },
] as const;

export const KART_PATTERNS = ["solid", "stripes", "checks", "flames"] as const;
export const KART_BODIES = ["standard", "wide", "wedge"] as const;
export const KART_WHEELS = ["slick", "white", "gold"] as const;

export type KartColorId = (typeof KART_COLORS)[number]["id"];
export type KartPattern = (typeof KART_PATTERNS)[number];
export type KartBody = (typeof KART_BODIES)[number];
export type KartWheels = (typeof KART_WHEELS)[number];

export type Livery = {
  color: KartColorId;
  pattern: KartPattern;
  body: KartBody;
  wheels: KartWheels;
};

export type LiveryStats = {
  /** Lateral grip multiplier. */
  grip: number;
  /** Drive and top-speed multiplier. */
  speed: number;
};

export function defaultLivery(): Livery {
  return { color: "apex", pattern: "stripes", body: "standard", wheels: "slick" };
}

export function liveryColor(livery: Livery): string {
  return KART_COLORS.find((c) => c.id === livery.color)?.hex ?? KART_COLORS[0].hex;
}

export function liveryStats(livery: Livery): LiveryStats {
  const body =
    livery.body === "wide"
      ? { grip: 1.14, speed: 0.93 }
      : livery.body === "wedge"
        ? { grip: 0.9, speed: 1.08 }
        : { grip: 1, speed: 1 };
  const wheel = livery.wheels === "gold" ? 1.05 : livery.wheels === "white" ? 0.96 : 1;
  return { grip: body.grip * wheel, speed: body.speed };
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function parseLivery(raw: string | null | undefined): Livery {
  const base = defaultLivery();
  if (!raw) return base;
  try {
    const data = JSON.parse(raw) as Partial<Livery>;
    return {
      color: oneOf(data.color, KART_COLORS.map((c) => c.id), base.color),
      pattern: oneOf(data.pattern, KART_PATTERNS, base.pattern),
      body: oneOf(data.body, KART_BODIES, base.body),
      wheels: oneOf(data.wheels, KART_WHEELS, base.wheels),
    };
  } catch {
    return base;
  }
}

export function serializeLivery(livery: Livery): string {
  return JSON.stringify(parseLivery(JSON.stringify(livery)));
}

export function loadLivery(): Livery {
  if (typeof window === "undefined") return defaultLivery();
  try {
    return parseLivery(window.localStorage.getItem(KART2_LIVERY_KEY));
  } catch {
    return defaultLivery();
  }
}

export function saveLivery(livery: Livery) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KART2_LIVERY_KEY, serializeLivery(livery));
  } catch {
    // private mode / quota — the kart still races with this livery
  }
}
