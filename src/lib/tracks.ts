export type Track = {
  id: string;
  name: string;
  location: string;
  /** Community session count. Higher values sort first on the homepage. */
  popularity: number;
  /** Circuit reference point. Catalog GPS is shifted onto this from the sample trace. */
  lat: number;
  lon: number;
  search: string;
};

export const TRACKS: Track[] = [
  {
    id: "spreewaldring",
    name: "Spreewaldring Training Center",
    location: "Waldow/Brand, Germany",
    popularity: 19200,
    lat: 51.99907,
    lon: 13.6883,
    search: "spreewaldring stc brandenburg germany trackaddict",
  },
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
    id: "buttonwillow-13cw",
    name: "Buttonwillow Raceway — 13CW",
    location: "Buttonwillow, California",
    popularity: 13200,
    // Wikipedia / park coords (~Race #13 CW). "Buttonwillow Circuit" titles map here.
    lat: 35.4913,
    lon: -119.5449,
    search: "buttonwillow 13cw cw13 circuit california",
  },
  {
    id: "streets-of-willow-cw",
    name: "Streets of Willow — CW",
    location: "Rosamond, California",
    popularity: 11800,
    // Willow Springs / Streets of Willow complex
    lat: 34.874,
    lon: -118.263,
    search: "streets of willow willow springs cw california",
  },
  {
    id: "spa",
    name: "Circuit de Spa-Francorchamps",
    location: "Spa-Francorchamps, Belgium",
    popularity: 18620,
    lat: 50.4372,
    lon: 5.9714,
    search: "spa francorchamps belgium",
  },
  {
    id: "nurburgring",
    name: "Nürburgring Grand Prix",
    location: "Nürburg, Germany",
    popularity: 17140,
    lat: 50.334,
    lon: 6.943,
    search: "nurburgring nurburg germany gp nordschleife",
  },
  {
    id: "monza",
    name: "Autodromo Nazionale Monza",
    location: "Monza, Italy",
    popularity: 15990,
    lat: 45.6156,
    lon: 9.2811,
    search: "monza italy",
  },
  {
    id: "suzuka",
    name: "Suzuka International Racing Course",
    location: "Suzuka, Japan",
    popularity: 14820,
    lat: 34.8431,
    lon: 136.5407,
    search: "suzuka japan",
  },
  {
    id: "laguna-seca",
    name: "WeatherTech Raceway Laguna Seca",
    location: "Monterey, California",
    popularity: 13650,
    lat: 36.59063,
    lon: -121.7537,
    search: "laguna seca monterey california weathertech",
  },
  {
    id: "silverstone",
    name: "Silverstone Circuit",
    location: "Silverstone, England",
    popularity: 12410,
    lat: 52.0733,
    lon: -1.0147,
    search: "silverstone england uk",
  },
  {
    id: "cota",
    name: "Circuit of the Americas",
    location: "Austin, Texas",
    popularity: 11180,
    lat: 30.1328,
    lon: -97.6411,
    search: "cota austin texas circuit of the americas",
  },
  {
    id: "watkins-glen",
    name: "Watkins Glen International",
    location: "Watkins Glen, New York",
    popularity: 9720,
    lat: 42.3369,
    lon: -76.927,
    search: "watkins glen new york",
  },
  {
    id: "brands-hatch",
    name: "Brands Hatch",
    location: "Kent, England",
    popularity: 8640,
    lat: 51.3569,
    lon: 0.2631,
    search: "brands hatch kent england uk",
  },
  {
    id: "road-atlanta",
    name: "Road Atlanta",
    location: "Braselton, Georgia",
    popularity: 7510,
    lat: 34.1547,
    lon: -83.8128,
    search: "road atlanta braselton georgia",
  },
];

const CUSTOM_TRACKS_KEY = "apex.local-tracks";

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

export function builtinTrack(id: string): Track | null {
  return TRACKS.find((track) => track.id === id) ?? null;
}

export function getTrack(id: string): Track | null {
  return (
    builtinTrack(id) ??
    listCustomTracks().find((track) => track.id === id) ??
    null
  );
}

export function findTrackByName(name: string, extras: Track[] = listCustomTracks()): Track | null {
  const needle = normalizeTrackQuery(name.trim());
  if (!needle) return null;
  return (
    [...TRACKS, ...extras].find((track) => normalizeTrackQuery(track.name) === needle) ??
    null
  );
}

export function saveCustomTrack(name: string): Track {
  const trimmed = name.trim();
  const existing = findTrackByName(trimmed);
  if (existing) return existing;

  const custom = listCustomTracks();
  const base = `custom-${slugify(trimmed)}`;
  const taken = new Set([...TRACKS, ...custom].map((track) => track.id));
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
  for (const extra of extras) {
    if (!merged.some((track) => track.id === extra.id)) merged.push(extra);
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
