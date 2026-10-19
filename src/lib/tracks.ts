export type Track = {
  id: string;
  name: string;
  location: string;
  /** Community session count. Higher values sort first on the homepage. */
  popularity: number;
  /** Circuit reference point. */
  lat: number;
  lon: number;
  search: string;
};

/**
 * Minimal built-in list: real circuits Jason uses, with real coordinates.
 * User-created / shared tracks come from Supabase + localStorage.
 */
export const TRACKS: Track[] = [
  {
    id: "thunderhill-east",
    name: "Thunderhill Raceway — East",
    location: "Willows, California",
    popularity: 14100,
    lat: 39.5385,
    lon: -122.3312,
    search: "thunderhill east willows california",
  },
  {
    id: "thunderhill-west",
    name: "Thunderhill Raceway — West",
    location: "Willows, California",
    popularity: 12800,
    // Dragy DRG71 sample near West course
    lat: 39.53905,
    lon: -122.3387,
    search: "thunderhill west willows california",
  },
  {
    id: "buttonwillow-13cw",
    name: "Buttonwillow Raceway — 13CW",
    location: "Buttonwillow, California",
    popularity: 13200,
    lat: 35.4913,
    lon: -119.5449,
    search: "buttonwillow 13cw cw13 circuit california",
  },
  {
    id: "streets-of-willow-cw",
    name: "Streets of Willow — CW",
    location: "Rosamond, California",
    popularity: 11800,
    lat: 34.874,
    lon: -118.263,
    search: "streets of willow willow springs cw california",
  },
];

const CUSTOM_TRACKS_KEY = "apex.local-tracks";

/** In-memory shared tracks loaded from Supabase (browser). */
let sharedTracksCache: Track[] = [];

export function normalizeTrackQuery(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugify(name: string) {
  const slug = normalizeTrackQuery(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "track";
}

export function listCustomTracks(): Track[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TRACKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Track[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCustomTracks(tracks: Track[]) {
  window.localStorage.setItem(CUSTOM_TRACKS_KEY, JSON.stringify(tracks));
}

export function listSharedTracksCache(): Track[] {
  return sharedTracksCache;
}

export function setSharedTracksCache(tracks: Track[]) {
  sharedTracksCache = tracks;
}

export function builtinTrack(id: string): Track | null {
  return TRACKS.find((track) => track.id === id) ?? null;
}

export function getTrack(id: string): Track | null {
  return (
    builtinTrack(id) ??
    sharedTracksCache.find((track) => track.id === id) ??
    listCustomTracks().find((track) => track.id === id) ??
    null
  );
}

export function findTrackByName(
  name: string,
  extras: Track[] = [...listSharedTracksCache(), ...listCustomTracks()],
): Track | null {
  const needle = normalizeTrackQuery(name.trim());
  if (!needle) return null;
  return (
    [...TRACKS, ...extras].find(
      (track) => normalizeTrackQuery(track.name) === needle,
    ) ?? null
  );
}

/** Local-only custom track (signed-out uploads). Prefer ensureSharedTrack when cloud. */
export function saveCustomTrack(name: string): Track {
  const trimmed = name.trim();
  const existing = findTrackByName(trimmed);
  if (existing) return existing;

  const custom = listCustomTracks();
  const base = `custom-${slugify(trimmed)}`;
  const taken = new Set([
    ...TRACKS,
    ...listSharedTracksCache(),
    ...custom,
  ].map((track) => track.id));
  let id = base;
  if (taken.has(id)) id = `${base}-${crypto.randomUUID().slice(0, 8)}`;

  const track: Track = {
    id,
    name: trimmed,
    location: "Added in this browser",
    popularity: 0,
    lat: 0,
    lon: 0,
    search: trimmed,
  };
  writeCustomTracks([track, ...custom]);
  return track;
}

export function popularTracks(query = "", extras: Track[] = []): Track[] {
  const merged = [...TRACKS];
  for (const extra of [...listSharedTracksCache(), ...extras]) {
    if (!merged.some((item) => item.id === extra.id)) merged.push(extra);
  }
  const ranked = merged.sort(
    (a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name),
  );
  const needle = normalizeTrackQuery(query.trim());
  if (!needle) return ranked;
  return ranked.filter((track) =>
    normalizeTrackQuery(`${track.name} ${track.location} ${track.search}`).includes(needle),
  );
}
