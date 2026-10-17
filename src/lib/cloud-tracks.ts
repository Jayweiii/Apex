import {
  builtinTrack,
  findTrackByName,
  normalizeTrackQuery,
  type Track,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

export type CloudTrackRow = {
  id: string;
  name: string;
  location: string;
  layout?: string | null;
  lat: number;
  lon: number;
  start_finish?: unknown;
  centerline?: unknown;
  created_by?: string | null;
  created_at?: string;
};

function slugify(name: string) {
  const slug = normalizeTrackQuery(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "track";
}

export function cloudRowToTrack(row: CloudTrackRow): Track {
  return {
    id: row.id,
    name: row.name,
    location: row.location || (row.layout ? String(row.layout) : "Community"),
    popularity: 1,
    lat: Number(row.lat) || 0,
    lon: Number(row.lon) || 0,
    search: `${row.name} ${row.location ?? ""} ${row.layout ?? ""}`,
  };
}

function centerFromPoints(points: TelemetryPoint[]): {
  lat: number;
  lon: number;
  centerline: Array<{ lat: number; lon: number }>;
  startFinish: { lat: number; lon: number } | null;
} | null {
  const gps = points.filter(
    (point): point is TelemetryPoint & { lat: number; lon: number } =>
      point.lat != null && point.lon != null,
  );
  if (gps.length < 3) return null;
  // Downsample for storage.
  const step = Math.max(1, Math.floor(gps.length / 200));
  const centerline = gps
    .filter((_, index) => index % step === 0)
    .map((point) => ({ lat: point.lat, lon: point.lon }));
  const mid = gps[Math.floor(gps.length / 2)];
  return {
    lat: mid.lat,
    lon: mid.lon,
    centerline,
    startFinish: { lat: gps[0].lat, lon: gps[0].lon },
  };
}

/** Minimal shape; accepts the real Supabase browser client. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export async function fetchSharedTracks(
  client: SupabaseLike,
): Promise<Track[]> {
  const { data, error } = await client
    .from("tracks")
    .select(
      "id, name, location, layout, lat, lon, start_finish, centerline, created_by, created_at",
    )
    .order("name", { ascending: true });
  if (error) {
    // Table not migrated yet — callers fall back to local custom tracks.
    if (/tracks|relation|schema/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as CloudTrackRow[]).map(cloudRowToTrack);
}

/**
 * Find or create a shared track by name (+ optional location).
 * Matches built-ins and existing cloud rows first to avoid duplicates.
 */
export async function ensureSharedTrack(
  client: SupabaseLike,
  input: {
    name: string;
    location?: string;
    layout?: string;
    firstLapPoints?: TelemetryPoint[];
  },
): Promise<Track> {
  const trimmed = input.name.trim();
  if (!trimmed) throw new Error("Enter a track name");

  const location = (input.location ?? "Community").trim() || "Community";
  const existingBuiltin = findTrackByName(trimmed);
  if (existingBuiltin && builtinTrack(existingBuiltin.id)) {
    return existingBuiltin;
  }

  const shared = await fetchSharedTracks(client);
  const byName = findTrackByName(trimmed, shared);
  if (byName) {
    // Prefer exact location match when several share a name.
    const sameLocation = shared.find(
      (track) =>
        normalizeTrackQuery(track.name) === normalizeTrackQuery(trimmed) &&
        normalizeTrackQuery(track.location) === normalizeTrackQuery(location),
    );
    return sameLocation ?? byName;
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to create a shared track");

  const derived = input.firstLapPoints
    ? centerFromPoints(input.firstLapPoints)
    : null;

  const base = `custom-${slugify(trimmed)}`;
  const taken = new Set([
    ...shared.map((track) => track.id),
    ...(existingBuiltin ? [existingBuiltin.id] : []),
  ]);
  // Also avoid colliding with builtins.
  let id = base;
  if (builtinTrack(id) || taken.has(id)) {
    id = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  }

  const row = {
    id,
    name: trimmed,
    location,
    layout: input.layout?.trim() || null,
    lat: derived?.lat ?? 0,
    lon: derived?.lon ?? 0,
    start_finish: derived?.startFinish ?? null,
    centerline: derived?.centerline ?? null,
    created_by: user.id,
  };

  const { data, error } = await client
    .from("tracks")
    .insert(row)
    .select(
      "id, name, location, layout, lat, lon, start_finish, centerline, created_by, created_at",
    )
    .single();

  if (error) {
    // Unique race: someone else created the same name/location — re-fetch.
    if (/duplicate|unique|tracks_name_location/i.test(error.message)) {
      const again = await fetchSharedTracks(client);
      const match =
        again.find(
          (track) =>
            normalizeTrackQuery(track.name) === normalizeTrackQuery(trimmed) &&
            normalizeTrackQuery(track.location) ===
              normalizeTrackQuery(location),
        ) ?? findTrackByName(trimmed, again);
      if (match) return match;
    }
    if (/tracks|relation|schema|permission/i.test(error.message)) {
      throw new Error(
        "Shared tracks need migration supabase/migrations/20261017_shared_tracks.sql — run it in the Supabase SQL editor, then retry.",
      );
    }
    throw new Error(error.message);
  }

  return cloudRowToTrack(data as CloudTrackRow);
}
