/**
 * MapLibre GL JS v6 loads GeoJSON in a Web Worker resolved via import.meta.url.
 * Next.js rewrites that URL into a chunk that cannot load the sibling shared
 * module, so the worker fails and lap line layers never paint — basemap
 * rasters still work (main thread).
 *
 * Point the library at the copies under /public (scripts/copy-maplibre-worker.mjs).
 */
import { getWorkerUrl, setWorkerUrl } from "maplibre-gl";

const WORKER_URL = "/maplibre-gl-worker.mjs";

let ensured = false;

/** Idempotent; safe to call from every ChaseTrackMap mount. */
export function ensureMapLibreWorker() {
  if (ensured || typeof window === "undefined") return;
  try {
    if (getWorkerUrl() !== WORKER_URL) {
      setWorkerUrl(WORKER_URL);
    }
  } catch {
    setWorkerUrl(WORKER_URL);
  }
  ensured = true;
}

export const MAPLIBRE_WORKER_PUBLIC_URL = WORKER_URL;
