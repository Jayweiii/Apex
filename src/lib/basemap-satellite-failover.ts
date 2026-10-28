import {
  ESRI_IMAGERY,
  isSatelliteTileErrorMessage,
  rotateSatelliteTileUrls,
} from "@/lib/basemap-prefs";

type TileSource = {
  setTiles?: (tiles: string[]) => unknown;
};

type MapLike = {
  getSource: (id: string) => unknown;
  on: (type: string, listener: (e: { error?: unknown }) => void) => unknown;
  off?: (type: string, listener: (e: { error?: unknown }) => void) => unknown;
};

/**
 * MapLibre: on ArcGIS tile 502/CORS errors, rotate World_Imagery hosts via
 * setTiles and keep satellite visible (caller re-asserts street opacity 0).
 */
export function attachMapLibreSatelliteFailover(
  map: MapLike,
  sourceId: string,
  onRotated?: () => void,
): () => void {
  let hostIndex = 0;
  let lastRotateAt = 0;
  const COOLDOWN_MS = 1200;

  const rotate = () => {
    const now = Date.now();
    if (now - lastRotateAt < COOLDOWN_MS) return;
    lastRotateAt = now;
    hostIndex = (hostIndex + 1) % ESRI_IMAGERY.urls.length;
    const source = map.getSource(sourceId) as TileSource | undefined;
    if (!source?.setTiles) return;
    source.setTiles(rotateSatelliteTileUrls(hostIndex));
    onRotated?.();
  };

  const onError = (event: { error?: unknown }) => {
    const err = event.error as
      | { status?: number; message?: string; url?: string; name?: string }
      | string
      | undefined;
    const message =
      typeof err === "string"
        ? err
        : [err?.message, err?.url, err?.status, err?.name]
            .filter(Boolean)
            .join(" ");
    const status = typeof err === "object" && err ? err.status : undefined;
    const looksSatellite = isSatelliteTileErrorMessage(message);
    const hardFail =
      status === 502 ||
      status === 503 ||
      status === 0 ||
      /cors|failed to fetch|networkerror|loaderror|ajaxerror|tile/i.test(
        message,
      );
    // Rotate for satellite tile failures, or any hard fail that smells like imagery.
    if (
      !looksSatellite &&
      !(hardFail && /tile|imagery|raster|arcgis|esri|jpeg|png/i.test(message))
    ) {
      return;
    }
    rotate();
  };

  map.on("error", onError);

  return () => {
    map.off?.("error", onError);
  };
}

/** Prefer both hosts up front so MapLibre can spread load. */
export function satelliteTilesForStyle(): string[] {
  return rotateSatelliteTileUrls(0);
}
