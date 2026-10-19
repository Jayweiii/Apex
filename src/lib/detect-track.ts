import { haversineMeters } from "@/lib/map-match";
import {
  TRACKS,
  listCustomTracks,
  listSharedTracksCache,
  type Track,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

function medianCoord(points: TelemetryPoint[]): { lat: number; lon: number } | null {
  const lats = points
    .map((p) => p.lat)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const lons = points
    .map((p) => p.lon)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (lats.length < 10 || lons.length < 10) return null;
  const mid = Math.floor(lats.length / 2);
  const sortedLat = [...lats].sort((a, b) => a - b);
  const sortedLon = [...lons].sort((a, b) => a - b);
  return { lat: sortedLat[mid], lon: sortedLon[mid] };
}

/** Catalog tracks available without a network round-trip. */
export function catalogTracksForDetect(): Track[] {
  const merged: Track[] = [];
  for (const track of [
    ...TRACKS,
    ...listSharedTracksCache(),
    ...listCustomTracks(),
  ]) {
    if (!merged.some((item) => item.id === track.id)) merged.push(track);
  }
  return merged;
}

/**
 * Pick the nearest known track to the GPS cloud (median lat/lon).
 * Used when the uploader leaves track blank so SF / centerline can still
 * drive lap splits.
 */
export function detectNearestTrack(
  points: TelemetryPoint[],
  catalog: Track[] = catalogTracksForDetect(),
  options?: { maxMeters?: number },
): Track | null {
  const center = medianCoord(points);
  if (!center || !catalog.length) return null;
  const maxMeters = options?.maxMeters ?? 25_000;
  let best: { track: Track; dist: number } | null = null;
  for (const track of catalog) {
    if (!Number.isFinite(track.lat) || !Number.isFinite(track.lon)) continue;
    const dist = haversineMeters(center.lat, center.lon, track.lat, track.lon);
    if (dist > maxMeters) continue;
    if (!best || dist < best.dist) best = { track, dist };
  }
  return best?.track ?? null;
}
