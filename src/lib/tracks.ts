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
  /**
   * Supabase tracks.start_finish jsonb when loaded from cloud.
   * Upload / re-parse must prefer this over catalog aliases.
   */
  startFinish?: unknown;
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
    // Front-straight timing line (hot-lap SF crossings ~39.53776, -122.33875).
    // Previous catalog point (39.53905) sat ~140 m north of the real line.
    lat: 39.53776,
    lon: -122.33875,
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

/**
 * Fuzzy identity for preset ↔ community duplicates.
 * "Thunderhill Raceway — West" and "Thunderhill West" → "thunderhill west".
 */
export function trackIdentityKey(value: string) {
  return normalizeTrackQuery(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(raceway|park|circuit|motorsport|motorsports|speedway|the|of)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(name: string) {
  const slug = normalizeTrackQuery(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "track";
}

/** Prefer community/DB row over builtin so sessions stay on the shared id. */
export function preferTrackDuplicate(a: Track, b: Track): Track {
  const aBuiltin = Boolean(builtinTrack(a.id));
  const bBuiltin = Boolean(builtinTrack(b.id));
  let preferred = a;
  let other = b;
  if (aBuiltin && !bBuiltin) {
    preferred = b;
    other = a;
  } else if (!aBuiltin && bBuiltin) {
    preferred = a;
    other = b;
  } else if (b.popularity > a.popularity) {
    preferred = b;
    other = a;
  }
  const genericLocation =
    !preferred.location ||
    preferred.location === "Community" ||
    preferred.location === "Added in this browser";
  // Prefer the richer display name (e.g. "Thunderhill Raceway — West").
  const preferredName =
    preferred.name.length >= other.name.length ? preferred.name : other.name;
  return {
    ...preferred,
    name: preferredName,
    popularity: Math.max(preferred.popularity, other.popularity),
    lat: preferred.lat || other.lat,
    lon: preferred.lon || other.lon,
    location: genericLocation
      ? other.location || preferred.location
      : preferred.location,
    search: `${preferred.search} ${other.search}`.trim(),
  };
}

/** Dedupe a track list by identity key (name), keeping one row per circuit. */
export function dedupeTracksByIdentity(tracks: Track[]): Track[] {
  const byKey = new Map<string, Track>();
  for (const track of tracks) {
    const key = trackIdentityKey(track.name) || track.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, track);
      continue;
    }
    byKey.set(key, preferTrackDuplicate(existing, track));
  }
  return [...byKey.values()];
}

function allKnownTracks(): Track[] {
  return [...TRACKS, ...sharedTracksCache, ...listCustomTracks()];
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

/**
 * When a community id aliases a builtin circuit, return the builtin id
 * (centerlines / start-finish). Otherwise null.
 */
export function resolveBuiltinAlias(
  trackId: string | null | undefined,
): string | null {
  if (!trackId) return null;
  if (builtinTrack(trackId)) return trackId;
  // custom-<builtin-slug> (e.g. custom-thunderhill-west) → builtin, even on
  // the server where sharedTracksCache is empty. Fixes SF for re-parse.
  if (trackId.startsWith("custom-")) {
    const slug = trackId.slice("custom-".length);
    if (builtinTrack(slug)) return slug;
  }
  const named =
    sharedTracksCache.find((track) => track.id === trackId) ??
    listCustomTracks().find((track) => track.id === trackId) ??
    null;
  if (!named) return null;
  const key = trackIdentityKey(named.name);
  if (!key) return null;
  return TRACKS.find((track) => trackIdentityKey(track.name) === key)?.id ?? null;
}

/**
 * Canonical track for UI / uploads: prefer the community/DB row when a
 * preset and a shared row describe the same circuit.
 */
export function resolveCanonicalTrack(
  trackId: string | null | undefined,
): Track | null {
  if (!trackId) return null;
  const track = getTrack(trackId);
  if (!track) return null;
  const key = trackIdentityKey(track.name);
  if (!key) return track;
  const peers = allKnownTracks().filter(
    (item) => trackIdentityKey(item.name) === key,
  );
  if (peers.length <= 1) return track;
  return peers.reduce((best, item) => preferTrackDuplicate(best, item));
}

/** All track ids that share identity with this id (builtin + custom + shared). */
export function trackEquivalentIds(
  trackId: string | null | undefined,
): string[] {
  if (!trackId) return [];
  const ids = new Set<string>([trackId]);
  // Builtin ↔ custom-<slug> twin even before sharedTracksCache loads — otherwise
  // /tracks/thunderhill-west misses public sessions stored as custom-thunderhill-west.
  if (builtinTrack(trackId)) {
    ids.add(`custom-${trackId}`);
  }
  if (trackId.startsWith("custom-")) {
    const slug = trackId.slice("custom-".length);
    if (builtinTrack(slug)) ids.add(slug);
  }
  const track = getTrack(trackId) ?? resolveCanonicalTrack(trackId);
  if (track) {
    ids.add(track.id);
    const key = trackIdentityKey(track.name);
    if (key) {
      for (const item of allKnownTracks()) {
        if (trackIdentityKey(item.name) === key) ids.add(item.id);
      }
    }
  }
  const alias = resolveBuiltinAlias(trackId);
  if (alias) {
    ids.add(alias);
    if (builtinTrack(alias)) ids.add(`custom-${alias}`);
  }
  const canonical = resolveCanonicalTrack(trackId);
  if (canonical) ids.add(canonical.id);
  return [...ids];
}

export function findTrackByName(
  name: string,
  extras: Track[] = [...listSharedTracksCache(), ...listCustomTracks()],
): Track | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const needleExact = normalizeTrackQuery(trimmed);
  const needleKey = trackIdentityKey(trimmed);
  if (!needleExact && !needleKey) return null;
  const pool = [...TRACKS, ...extras];
  // Prefer identity matches (and community over builtin) so
  // "Thunderhill Raceway — West" resolves to custom-thunderhill-west when present.
  if (needleKey) {
    const fuzzy = pool.filter(
      (track) => trackIdentityKey(track.name) === needleKey,
    );
    if (fuzzy.length === 1) return fuzzy[0];
    if (fuzzy.length > 1) {
      return fuzzy.reduce((best, track) => preferTrackDuplicate(best, track));
    }
  }
  return (
    pool.find((track) => normalizeTrackQuery(track.name) === needleExact) ??
    null
  );
}

/** Local-only custom track (signed-out uploads). Prefer ensureSharedTrack when cloud. */
export function saveCustomTrack(name: string): Track {
  const trimmed = name.trim();
  const existing = findTrackByName(trimmed);
  if (existing) return existing;

  const custom = listCustomTracks();
  const base = `custom-${slugify(trimmed)}`;
  const taken = new Set(
    [...TRACKS, ...listSharedTracksCache(), ...custom].map((track) => track.id),
  );
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
  const ranked = dedupeTracksByIdentity(merged).sort(
    (a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name),
  );
  const needle = normalizeTrackQuery(query.trim());
  if (!needle) return ranked;
  return ranked.filter((track) =>
    normalizeTrackQuery(
      `${track.name} ${track.location} ${track.search}`,
    ).includes(needle),
  );
}
