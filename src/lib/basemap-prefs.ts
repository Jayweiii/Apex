"use client";

export type BasemapMode = "satellite" | "street";

export const BASEMAP_PREFS_KEY = "apex.basemap";
export const BASEMAP_PREFS_EVENT = "apex:basemap";

export const DEFAULT_BASEMAP: BasemapMode = "satellite";

/**
 * Free Esri World Imagery — no API key.
 * Primary + alternate hosts: ArcGIS intermittently 502/CORS on one edge;
 * MapLibre/Leaflet failover rotates through these so Satellite never sticks
 * on blank / street-through holes until a manual re-tap.
 */
export const ESRI_IMAGERY_URLS = [
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
] as const;

export const ESRI_IMAGERY = {
  url: ESRI_IMAGERY_URLS[0],
  urls: [...ESRI_IMAGERY_URLS] as string[],
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

/** Free OSM street tiles. */
export const OSM_STREET = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  /** Single-host URL for MapLibre (no `{s}` subdomain template). */
  maplibreUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

export function parseBasemapMode(value: unknown): BasemapMode {
  return value === "street" ? "street" : "satellite";
}

export function readBasemapPrefs(): BasemapMode {
  if (typeof window === "undefined") return DEFAULT_BASEMAP;
  try {
    const raw = window.localStorage.getItem(BASEMAP_PREFS_KEY);
    if (!raw) return DEFAULT_BASEMAP;
    return parseBasemapMode(JSON.parse(raw));
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function writeBasemapPrefs(mode: BasemapMode) {
  if (typeof window === "undefined") return;
  const next = parseBasemapMode(mode);
  try {
    window.localStorage.setItem(BASEMAP_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent<BasemapMode>(BASEMAP_PREFS_EVENT, { detail: next }),
  );
}

/** Rotate satellite URL list so the next host is preferred. */
export function rotateSatelliteTileUrls(fromIndex = 0): string[] {
  const n = ESRI_IMAGERY_URLS.length;
  const start = ((fromIndex % n) + n) % n;
  return Array.from({ length: n }, (_, i) => ESRI_IMAGERY_URLS[(start + i) % n]!);
}

export function isSatelliteTileErrorMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("world_imagery") ||
    m.includes("arcgisonline") ||
    m.includes("basemap-satellite") ||
    m.includes("esri")
  );
}
