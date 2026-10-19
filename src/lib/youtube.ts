/** YouTube ID / title helpers and track-hint matching for onboard clips. */

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const TRACK_HINTS: Array<{ trackId: string; patterns: RegExp[] }> = [
  {
    trackId: "thunderhill-east",
    patterns: [/thunderhill\s*east/i, /thunder\s*hill\s*east/i],
  },
  {
    trackId: "thunderhill-west",
    patterns: [/thunderhill\s*west/i, /thunder\s*hill\s*west/i],
  },
  {
    trackId: "buttonwillow-13cw",
    patterns: [
      /buttonwillow\s*13\s*cw/i,
      /buttonwillow\s*cw\s*13/i,
      /buttonwillow\s*circuit/i,
      /buttonwillow/i,
    ],
  },
  {
    trackId: "streets-of-willow-cw",
    patterns: [/streets\s*of\s*willow/i, /willow\s*springs/i],
  },
];

export type TitleHints = {
  trackId?: string;
  lapMs?: number;
  /** Title precision: 1000 for m:ss, 100 for m:ss.d, 1 for m:ss.mmm */
  lapPrecisionMs: number;
  car?: string;
};

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YOUTUBE_ID_RE.test(raw)) return raw;

  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return id && YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && YOUTUBE_ID_RE.test(v)) return v;
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") &&
        parts[1] &&
        YOUTUBE_ID_RE.test(parts[1])
      ) {
        return parts[1];
      }
    }
  } catch {
    // not a URL
  }
  return null;
}

/** Parse trailing m:ss(.fff) lap time from a title. */
export function parseLapTimeFromTitle(title: string): {
  lapMs: number;
  precisionMs: number;
} | null {
  const match = title.trim().match(/(\d+):(\d{2})(?:\.(\d{1,3}))?\s*$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  const frac = match[3] ?? "";
  const fracMs = frac
    ? Number(frac.padEnd(3, "0").slice(0, 3))
    : 0;
  const lapMs = minutes * 60_000 + seconds * 1000 + fracMs;
  const precisionMs = frac.length === 0 ? 1000 : frac.length === 1 ? 100 : frac.length === 2 ? 10 : 1;
  return { lapMs, precisionMs };
}

export function parseTitleHints(title: string): TitleHints {
  const lap = parseLapTimeFromTitle(title);
  let trackId: string | undefined;
  for (const hint of TRACK_HINTS) {
    if (hint.patterns.some((re) => re.test(title))) {
      trackId = hint.trackId;
      break;
    }
  }
  let car: string | undefined;
  if (/\bnd1?\b/i.test(title) || /\bmiata\b/i.test(title)) {
    car = "ND Miata";
  }
  return {
    trackId,
    lapMs: lap?.lapMs,
    lapPrecisionMs: lap?.precisionMs ?? 1000,
    car,
  };
}

export function youtubeWatchUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeEmbedUrl(id: string) {
  return `https://www.youtube.com/embed/${id}`;
}
