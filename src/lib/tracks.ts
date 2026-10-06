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

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function getTrack(id: string): Track | null {
  return TRACKS.find((track) => track.id === id) ?? null;
}

export function popularTracks(query = ""): Track[] {
  const ranked = [...TRACKS].sort(
    (a, b) => b.popularity - a.popularity || a.name.localeCompare(b.name),
  );
  const needle = normalize(query.trim());
  if (!needle) return ranked;
  return ranked.filter((track) =>
    normalize(`${track.name} ${track.location} ${track.search}`).includes(needle),
  );
}
