import {
  DEMO_ATTRIBUTION,
  type DataKind,
  type DatasetAttribution,
} from "@/lib/attribution";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import type { StoredSession } from "@/lib/local-store";
import type { TelemetryPoint } from "@/lib/types";

/** Best lap in public/sample-telemetry.csv (1:31.200). */
export const SAMPLE_BEST_MS = 91200;

export type CatalogSession = {
  id: string;
  trackId: string;
  car: string;
  name: string;
  kind: DataKind;
  /** Multiplier on the synthetic sample laps. Above 1 is slower. Ignored for public JSON seeds. */
  timeScale?: number;
  /** Path under /public for a real public dataset JSON seed. */
  datasetPath?: string;
  /** Lap count for list UIs before the dataset is loaded. */
  lapCount?: number;
  attribution: DatasetAttribution;
};

type PublicDatasetFile = {
  id: string;
  kind: DataKind;
  trackId: string;
  car: string;
  name: string;
  filename?: string;
  created_at?: string;
  attribution: DatasetAttribution;
  laps: {
    lapNumber: number;
    lapTimeMs: number;
    points: TelemetryPoint[];
  }[];
};

/** Real public sessions first; a small synthetic Laguna set remains for demos. */
export const CATALOG_SESSIONS: CatalogSession[] = [
  {
    id: "pub-spreewaldring-stc",
    trackId: "spreewaldring",
    car: "Street / track day",
    name: "Spreewaldring — TrackAddict log",
    kind: "public",
    datasetPath: "/datasets/spreewaldring-stc.json",
    lapCount: 2,
    attribution: {
      source: "trackaddict-cli example dataset (STC_log.csv)",
      author: "Thomas Jungblut",
      url: "https://github.com/thomasjungblut/trackaddict-cli",
      license: "Apache-2.0",
      licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
      notes:
        "Original TrackAddict export from Spreewaldring Training Center. Bundled under Apache-2.0 with attribution.",
    },
  },
  {
    id: "demo-laguna-seca-gt3",
    trackId: "laguna-seca",
    car: "Porsche 911 GT3",
    name: "GT3 — Saturday (demo)",
    kind: "demo",
    timeScale: 1,
    lapCount: 3,
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: "demo-laguna-seca-mx5",
    trackId: "laguna-seca",
    car: "Mazda MX-5",
    name: "Spec MX-5 (demo)",
    kind: "demo",
    timeScale: 1.28,
    lapCount: 3,
    attribution: DEMO_ATTRIBUTION,
  },
  {
    id: "demo-laguna-seca-radical",
    trackId: "laguna-seca",
    car: "Radical SR3",
    name: "SR3 test (demo)",
    kind: "demo",
    timeScale: 0.9,
    lapCount: 3,
    attribution: DEMO_ATTRIBUTION,
  },
];

export function catalogSessionsForTrack(trackId: string): CatalogSession[] {
  return CATALOG_SESSIONS.filter((session) => session.trackId === trackId);
}

export function getCatalogSession(id: string): CatalogSession | null {
  return CATALOG_SESSIONS.find((session) => session.id === id) ?? null;
}

export function catalogBestMs(session: CatalogSession): number {
  if (session.kind === "public") {
    // Filled from loaded dataset when available; homepage uses a static estimate.
    return session.id === "pub-spreewaldring-stc" ? 108011 : SAMPLE_BEST_MS;
  }
  return Math.round(SAMPLE_BEST_MS * (session.timeScale ?? 1));
}

let sampleLaps: Promise<Awaited<ReturnType<typeof parseTelemetryCsv>>["laps"]> | null =
  null;
const datasetCache = new Map<string, Promise<PublicDatasetFile>>();

function loadSampleLaps() {
  if (!sampleLaps) {
    sampleLaps = fetch("/sample-telemetry.csv").then(async (response) => {
      if (!response.ok) throw new Error("Could not load sample telemetry");
      const parsed = parseTelemetryCsv(await response.text());
      return parsed.laps;
    });
  }
  return sampleLaps;
}

function loadPublicDataset(path: string) {
  let pending = datasetCache.get(path);
  if (!pending) {
    pending = fetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load dataset ${path}`);
      return (await response.json()) as PublicDatasetFile;
    });
    datasetCache.set(path, pending);
  }
  return pending;
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
  const entry = getCatalogSession(id);
  if (!entry) return null;

  if (entry.kind === "public" && entry.datasetPath) {
    const dataset = await loadPublicDataset(entry.datasetPath);
    return {
      id: entry.id,
      name: entry.name,
      filename: dataset.filename ?? entry.datasetPath,
      created_at: dataset.created_at ?? "2019-06-05T00:00:00.000Z",
      trackId: entry.trackId,
      car: entry.car,
      kind: "public",
      attribution: entry.attribution,
      laps: dataset.laps.map((lap) => ({
        id: `${entry.id}-lap-${lap.lapNumber}`,
        lap_number: lap.lapNumber,
        lap_time_ms: lap.lapTimeMs,
        telemetry: lap.points,
      })),
    };
  }

  const laps = await loadSampleLaps();
  const timeScale = entry.timeScale ?? 1;

  return {
    id: entry.id,
    name: entry.name,
    filename: "sample-telemetry.csv",
    created_at: "2026-01-01T00:00:00.000Z",
    trackId: entry.trackId,
    car: entry.car,
    kind: "demo",
    attribution: entry.attribution,
    laps: laps.map((lap) => ({
      id: `${entry.id}-lap-${lap.lapNumber}`,
      lap_number: lap.lapNumber,
      lap_time_ms: Math.round(lap.lapTimeMs * timeScale),
      telemetry: lap.points.map((point) => shiftPoint(point, timeScale, 0, 0)),
      start_offset_sec: lap.startOffsetSec,
      started_at_ms: lap.startedAtMs,
    })),
  };
}
