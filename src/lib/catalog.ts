import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { getTrack } from "@/lib/tracks";
import type { StoredSession } from "@/lib/local-store";
import type { TelemetryPoint } from "@/lib/types";

/** Best lap in public/sample-telemetry.csv (1:31.200). */
export const SAMPLE_BEST_MS = 91200;

/** First GPS sample in the file. Laguna Seca uses this point with no shift. */
const SAMPLE_LAT = 36.59063;
const SAMPLE_LON = -121.7537;

export type CatalogSession = {
  id: string;
  trackId: string;
  car: string;
  name: string;
  /** Multiplier on the sample laps. Above 1 is a slower car. */
  timeScale: number;
};

export const CATALOG_SESSIONS: CatalogSession[] = [
  { id: "pub-spa-ferrari-296", trackId: "spa", car: "Ferrari 296 GT3", name: "Ferrari 296 — Qualifying", timeScale: 1.015 },
  { id: "pub-spa-mercedes-amg", trackId: "spa", car: "Mercedes-AMG GT3", name: "AMG — Race stint", timeScale: 1.04 },
  { id: "pub-spa-porsche-911", trackId: "spa", car: "Porsche 911 GT3 R", name: "Porsche — Saturday", timeScale: 1.0 },
  { id: "pub-nurburgring-aston", trackId: "nurburgring", car: "Aston Martin Vantage GT3", name: "Vantage — Practice", timeScale: 1.05 },
  { id: "pub-nurburgring-bmw", trackId: "nurburgring", car: "BMW M4 GT3", name: "M4 — Afternoon", timeScale: 1.02 },
  { id: "pub-nurburgring-porsche", trackId: "nurburgring", car: "Porsche 911 GT3 R", name: "Porsche — GP lap", timeScale: 1.0 },
  { id: "pub-monza-corvette", trackId: "monza", car: "Chevrolet Corvette Z06 GT3.R", name: "Corvette — Morning", timeScale: 1.01 },
  { id: "pub-monza-ferrari", trackId: "monza", car: "Ferrari 296 GT3", name: "Ferrari — Hot lap", timeScale: 0.99 },
  { id: "pub-monza-lamborghini", trackId: "monza", car: "Lamborghini Huracán GT3", name: "Huracán — Race", timeScale: 1.03 },
  { id: "pub-suzuka-honda", trackId: "suzuka", car: "Honda NSX GT3", name: "NSX — Test", timeScale: 1.06 },
  { id: "pub-suzuka-nissan", trackId: "suzuka", car: "Nissan Z GT500", name: "Z — Super lap", timeScale: 0.94 },
  { id: "pub-suzuka-porsche", trackId: "suzuka", car: "Porsche 911 GT3", name: "GT3 — Evening", timeScale: 1.0 },
  { id: "pub-laguna-seca-mazda", trackId: "laguna-seca", car: "Mazda MX-5", name: "Spec MX-5", timeScale: 1.28 },
  { id: "pub-laguna-seca-porsche-a", trackId: "laguna-seca", car: "Porsche 911 GT3", name: "GT3 — Saturday", timeScale: 1 },
  { id: "pub-laguna-seca-porsche-b", trackId: "laguna-seca", car: "Porsche 911 GT3", name: "GT3 — Sunday warm-up", timeScale: 1.012 },
  { id: "pub-laguna-seca-radical", trackId: "laguna-seca", car: "Radical SR3", name: "SR3 test", timeScale: 0.9 },
  { id: "pub-silverstone-aston", trackId: "silverstone", car: "Aston Martin Vantage GT3", name: "Vantage — National", timeScale: 1.04 },
  { id: "pub-silverstone-mclaren", trackId: "silverstone", car: "McLaren 720S GT3", name: "720S — Qualifying", timeScale: 0.985 },
  { id: "pub-cota-cadillac", trackId: "cota", car: "Cadillac V-Series.R", name: "Cadillac — Prototype", timeScale: 0.93 },
  { id: "pub-cota-ford", trackId: "cota", car: "Ford Mustang GT3", name: "Mustang — Practice", timeScale: 1.03 },
  { id: "pub-watkins-glen-bmw", trackId: "watkins-glen", car: "BMW M4 GT4", name: "M4 GT4 — Club", timeScale: 1.12 },
  { id: "pub-watkins-glen-porsche", trackId: "watkins-glen", car: "Porsche 911 GT3 Cup", name: "Cup — Sprint", timeScale: 1.0 },
  { id: "pub-brands-hatch-caterham", trackId: "brands-hatch", car: "Caterham Seven", name: "Seven — Indy", timeScale: 1.35 },
  { id: "pub-brands-hatch-porsche", trackId: "brands-hatch", car: "Porsche 718 Cayman GT4", name: "Cayman — Club", timeScale: 1.18 },
  { id: "pub-road-atlanta-audi", trackId: "road-atlanta", car: "Audi R8 LMS", name: "R8 — Petit", timeScale: 1.02 },
  { id: "pub-road-atlanta-porsche", trackId: "road-atlanta", car: "Porsche 911 GT3 R", name: "Porsche — Sunday", timeScale: 1.0 },
];

export function catalogSessionsForTrack(trackId: string): CatalogSession[] {
  return CATALOG_SESSIONS.filter((session) => session.trackId === trackId);
}

export function catalogBestMs(session: CatalogSession): number {
  return Math.round(SAMPLE_BEST_MS * session.timeScale);
}

let sampleLaps: Promise<ReturnType<typeof parseTelemetryCsv>> | null = null;

function loadSampleLaps() {
  if (!sampleLaps) {
    sampleLaps = fetch("/sample-telemetry.csv").then(async (response) => {
      if (!response.ok) throw new Error("Could not load sample telemetry");
      return parseTelemetryCsv(await response.text());
    });
  }
  return sampleLaps;
}

function shiftPoint(
  point: TelemetryPoint,
  timeScale: number,
  dLat: number,
  dLon: number,
): TelemetryPoint {
  return {
    ...point,
    t: point.t * timeScale,
    speed: point.speed / timeScale,
    lat: point.lat != null ? point.lat + dLat : undefined,
    lon: point.lon != null ? point.lon + dLon : undefined,
  };
}

export async function loadCatalogSession(id: string): Promise<StoredSession | null> {
  const entry = CATALOG_SESSIONS.find((session) => session.id === id);
  if (!entry) return null;
  const track = getTrack(entry.trackId);
  if (!track) return null;

  const laps = await loadSampleLaps();
  const dLat = track.lat - SAMPLE_LAT;
  const dLon = track.lon - SAMPLE_LON;

  return {
    id: entry.id,
    name: entry.name,
    filename: "sample-telemetry.csv",
    created_at: "2026-01-01T00:00:00.000Z",
    trackId: entry.trackId,
    car: entry.car,
    laps: laps.map((lap) => ({
      id: `${entry.id}-lap-${lap.lapNumber}`,
      lap_number: lap.lapNumber,
      lap_time_ms: Math.round(lap.lapTimeMs * entry.timeScale),
      telemetry: lap.points.map((point) =>
        shiftPoint(point, entry.timeScale, dLat, dLon),
      ),
    })),
  };
}
