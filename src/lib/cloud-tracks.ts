import { builtinCenterline } from "@/lib/centerlines";
import {
  buildCenterlineFromLaps,
  parseCenterline,
  type LatLon,
} from "@/lib/map-match";
import {
  builtinTrack,
  findTrackByName,
  normalizeTrackQuery,
  resolveBuiltinAlias,
  trackIdentityKey,
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
  centerline: LatLon[];
  startFinish: { lat: number; lon: number } | null;
} | null {
  const gps = points.filter(
    (point): point is TelemetryPoint & { lat: number; lon: number } =>
      point.lat != null && point.lon != null,
  );
  if (gps.length < 3) return null;
  const centerline =
    buildCenterlineFromLaps([points], { maxPoints: 200 }) ??
    (() => {
      const step = Math.max(1, Math.floor(gps.length / 200));
      return gps
        .filter((_, index) => index % step === 0)
        .map((point) => ({ lat: point.lat, lon: point.lon }));
    })();
  const mid = centerline[Math.floor(centerline.length / 2)] ?? gps[Math.floor(gps.length / 2)];
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

/** Resolve stored / built-in / lap-derived centerline for a track id. */
export function resolveTrackCenterline(
  trackId: string | null | undefined,
  stored?: unknown,
  sampleLaps?: TelemetryPoint[][],
): LatLon[] | null {
  const fromDb = parseCenterline(stored);
  if (fromDb) return fromDb;
  const alias = resolveBuiltinAlias(trackId) ?? trackId;
  const builtin = builtinCenterline(alias) ?? builtinCenterline(trackId);
  if (builtin) return builtin;
  if (sampleLaps?.length) return buildCenterlineFromLaps(sampleLaps);
  return null;
}

export async function fetchTrackCenterline(
  client: SupabaseLike,
  trackId: string | null | undefined,
): Promise<LatLon[] | null> {
  if (!trackId) return builtinCenterline(trackId);
  const alias = resolveBuiltinAlias(trackId) ?? trackId;
  const builtin = builtinCenterline(alias) ?? builtinCenterline(trackId);
  try {
    const { data, error } = await client
      .from("tracks")
      .select("centerline")
      .eq("id", trackId)
      .maybeSingle();
    if (error) return builtin;
    return parseCenterline(data?.centerline) ?? builtin;
  } catch {
    return builtin;
  }
}

/**
 * Refresh tracks.centerline from the cleanest laps when missing or short.
 * Safe no-op if the row is missing or RLS blocks updates.
 */
export async function maybeRefreshTrackCenterline(
  client: SupabaseLike,
  trackId: string,
  laps: TelemetryPoint[][],
): Promise<LatLon[] | null> {
  const built = buildCenterlineFromLaps(laps);
  if (!built) return builtinCenterline(trackId);

  try {
    const { data } = await client
      .from("tracks")
      .select("centerline")
      .eq("id", trackId)
      .maybeSingle();
    const existing = parseCenterline(data?.centerline);
    if (existing && existing.length >= built.length * 0.8) {
      return existing;
    }
    await client
      .from("tracks")
      .update({ centerline: built })
      .eq("id", trackId);
  } catch {
    // Best-effort; callers still get the in-memory centerline.
  }
  return built;
}

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
 * Matches existing cloud rows first (keeps sessions on community ids),
 * then built-ins, using fuzzy identity so "Thunderhill West" ≡ preset West.
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
  const needleKey = trackIdentityKey(trimmed);

  const shared = await fetchSharedTracks(client);
  const byShared = findTrackByName(trimmed, shared);
  if (byShared) {
    // Prefer exact location match when several share a name.
    const sameLocation = shared.find(
      (track) =>
        trackIdentityKey(track.name) === needleKey &&
        normalizeTrackQuery(track.location) === normalizeTrackQuery(location),
    );
    return sameLocation ?? byShared;
  }

  // No community row — reuse builtin preset when the name is the same circuit.
  const existingBuiltin = findTrackByName(trimmed, []);
  if (existingBuiltin && builtinTrack(existingBuiltin.id)) {
    return existingBuiltin;
  }

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to create a shared track");

  const derived = input.firstLapPoints
    ? centerFromPoints(input.firstLapPoints)
    : null;
  const namedBuiltin = findTrackByName(trimmed, []);
  const preferredLine =
    builtinCenterline(namedBuiltin?.id) ??
    builtinCenterline(resolveBuiltinAlias(namedBuiltin?.id));

  const base = `custom-${slugify(trimmed)}`;
  const taken = new Set([
    ...shared.map((track) => track.id),
    ...(namedBuiltin ? [namedBuiltin.id] : []),
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
    lat: derived?.lat ?? namedBuiltin?.lat ?? 0,
    lon: derived?.lon ?? namedBuiltin?.lon ?? 0,
    start_finish: derived?.startFinish ?? null,
    centerline: preferredLine ?? derived?.centerline ?? null,
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
            trackIdentityKey(track.name) === needleKey &&
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
