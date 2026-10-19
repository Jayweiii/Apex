import type { DataKind, DatasetAttribution } from "@/lib/attribution";
import type { StoredSession } from "@/lib/local-store";
import type { TelemetryPoint } from "@/lib/types";

/**
 * Optional public / demo catalog entries.
 * Intentionally empty at init — no auto-seeded sessions.
 * The Spreewaldring STC JSON under public/datasets/ remains available for
 * manual rebuild via scripts/build-public-dataset.ts; it is not registered here.
 */
export type CatalogSession = {
  id: string;
  trackId: string;
  car: string;
  name: string;
  kind: DataKind;
  /** Path under /public for a real public dataset JSON (optional import only). */
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

/** No seeded catalog sessions — users upload their own. */
export const CATALOG_SESSIONS: CatalogSession[] = [];

export function catalogSessionsForTrack(trackId: string): CatalogSession[] {
  return CATALOG_SESSIONS.filter((session) => session.trackId === trackId);
}

export function getCatalogSession(id: string): CatalogSession | null {
  return CATALOG_SESSIONS.find((session) => session.id === id) ?? null;
}

export function catalogBestMs(session: CatalogSession): number {
  void session;
  return Number.POSITIVE_INFINITY;
}

const datasetCache = new Map<string, Promise<PublicDatasetFile>>();

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

/** Load a catalog entry if one is registered (none by default). */
export async function loadCatalogSession(id: string): Promise<StoredSession | null> {
  const entry = getCatalogSession(id);
  if (!entry) return null;

  if (entry.kind === "public" && entry.datasetPath) {
    const dataset = await loadPublicDataset(entry.datasetPath);
    return {
      id: entry.id,
      name: entry.name,
      filename: dataset.filename ?? entry.datasetPath,
      created_at: dataset.created_at ?? new Date().toISOString(),
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

  return null;
}
