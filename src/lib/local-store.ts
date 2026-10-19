import type { DataKind, DatasetAttribution } from "./attribution";
import type { GpsQuality } from "./gps-quality";
import type { ParsedLap, SessionVideo, TelemetryPoint } from "./types";

const STORAGE_KEY = "apex.local-sessions";
const DRIVERS_KEY = "apex.local-drivers";
const KNOWN_CARS_KEY = "apex.local-cars";

export type StoredLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
  start_offset_sec?: number;
  started_at_ms?: number;
};

export type SessionSourceKind = "csv" | "gopro" | "logger";

export type StoredSession = {
  id: string;
  name: string;
  filename: string | null;
  created_at: string;
  laps: StoredLap[];
  trackId?: string;
  car?: string;
  carClass?: string;
  carTags?: string[];
  driver?: string;
  weather?: string;
  tires?: string;
  notes?: string;
  kind?: DataKind;
  attribution?: DatasetAttribution;
  sourceKind?: SessionSourceKind;
  gpsQuality?: GpsQuality | null;
  rawObjectKey?: string | null;
  /** @deprecated Prefer videos[]. Migrated on read. */
  videoObjectKey?: string | null;
  /** @deprecated Prefer videos[]. Migrated on read. */
  videoLocalKey?: string | null;
  storageBackend?: "r2" | "local" | "idb";
  startedAtMs?: number;
  sessionDate?: string;
  videos?: SessionVideo[];
};

export type DriverProfile = {
  id: string;
  name: string;
  created_at: string;
};

function migrateLegacyVideo(session: StoredSession): StoredSession {
  if (session.videos?.length) return session;
  if (!session.videoObjectKey && !session.videoLocalKey) return session;
  const video: SessionVideo = {
    id: crypto.randomUUID(),
    provider: "mp4",
    objectKey: session.videoObjectKey ?? undefined,
    localKey: session.videoLocalKey ?? undefined,
    // GoPro-source: GPMF cts is video time → offset 0 once lap start cts is kept.
    offsetSec: session.sourceKind === "gopro" ? 0 : 0,
    rate: 1,
    syncSource: session.sourceKind === "gopro" ? "auto" : "unsynced",
  };
  return { ...session, videos: [video] };
}

function normalizeSession(session: StoredSession): StoredSession {
  return migrateLegacyVideo(session);
}

function readAll(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeSession);
  } catch {
    return [];
  }
}

function writeAll(sessions: StoredSession[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function readDrivers(): DriverProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DRIVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDrivers(drivers: DriverProfile[]) {
  window.localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
}

function lapsFromParsed(laps: ParsedLap[]): StoredLap[] {
  return laps.map((lap) => ({
    id: crypto.randomUUID(),
    lap_number: lap.lapNumber,
    lap_time_ms: lap.lapTimeMs,
    telemetry: lap.points,
    start_offset_sec: lap.startOffsetSec,
    started_at_ms: lap.startedAtMs,
  }));
}

export function listLocalSessions(): StoredSession[] {
  return readAll().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getLocalSession(id: string): StoredSession | null {
  return readAll().find((session) => session.id === id) ?? null;
}

export function updateLocalSession(
  id: string,
  patch: Partial<StoredSession>,
): StoredSession | null {
  const sessions = readAll();
  const index = sessions.findIndex((session) => session.id === id);
  if (index < 0) return null;
  sessions[index] = normalizeSession({ ...sessions[index], ...patch });
  writeAll(sessions);
  return sessions[index];
}

export function replaceLocalSessionLaps(
  id: string,
  laps: ParsedLap[],
  meta?: { startedAtMs?: number; sessionDate?: string },
): StoredSession | null {
  return updateLocalSession(id, {
    laps: lapsFromParsed(laps),
    ...(meta?.startedAtMs != null ? { startedAtMs: meta.startedAtMs } : {}),
    ...(meta?.sessionDate ? { sessionDate: meta.sessionDate } : {}),
  });
}

export type SessionMetaInput = {
  id?: string;
  trackId?: string;
  car?: string;
  carClass?: string;
  carTags?: string[];
  driver?: string;
  weather?: string;
  tires?: string;
  notes?: string;
  sourceKind?: SessionSourceKind;
  gpsQuality?: GpsQuality | null;
  rawObjectKey?: string | null;
  videoObjectKey?: string | null;
  videoLocalKey?: string | null;
  storageBackend?: "r2" | "local" | "idb";
  startedAtMs?: number;
  sessionDate?: string;
  videos?: SessionVideo[];
};

export function saveLocalSession(
  name: string,
  filename: string | null,
  laps: ParsedLap[],
  meta?: SessionMetaInput,
): StoredSession {
  if (meta?.driver?.trim()) {
    ensureDriver(meta.driver.trim());
  }

  let videos = meta?.videos ?? [];
  if (!videos.length && (meta?.videoObjectKey || meta?.videoLocalKey)) {
    videos = [
      {
        id: crypto.randomUUID(),
        provider: "mp4",
        objectKey: meta.videoObjectKey ?? undefined,
        localKey: meta.videoLocalKey ?? undefined,
        offsetSec: 0,
        rate: 1,
        syncSource: meta.sourceKind === "gopro" ? "auto" : "unsynced",
      },
    ];
  }

  const session: StoredSession = {
    id: meta?.id ?? crypto.randomUUID(),
    name,
    filename,
    created_at: new Date().toISOString(),
    trackId: meta?.trackId,
    car: meta?.car,
    carClass: meta?.carClass,
    carTags: meta?.carTags ?? [],
    driver: meta?.driver,
    weather: meta?.weather,
    tires: meta?.tires,
    notes: meta?.notes,
    kind: "upload",
    sourceKind: meta?.sourceKind ?? "csv",
    gpsQuality: meta?.gpsQuality ?? null,
    rawObjectKey: meta?.rawObjectKey ?? null,
    videoObjectKey: meta?.videoObjectKey ?? null,
    videoLocalKey: meta?.videoLocalKey ?? null,
    storageBackend: meta?.storageBackend,
    startedAtMs: meta?.startedAtMs,
    sessionDate: meta?.sessionDate,
    videos,
    laps: lapsFromParsed(laps),
  };
  writeAll([session, ...readAll()]);
  return session;
}

function readRememberedCars(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KNOWN_CARS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Persist a car name locally so the picker stays filled without cloud. */
export function rememberKnownCar(name: string): void {
  const trimmed = name.trim();
  if (!trimmed || typeof window === "undefined") return;
  const names = new Set(readRememberedCars());
  names.add(trimmed);
  window.localStorage.setItem(
    KNOWN_CARS_KEY,
    JSON.stringify([...names].sort((a, b) => a.localeCompare(b))),
  );
}

/**
 * Cars known in this browser: remembered names + cars used on local sessions.
 * Cloud / shared cars are merged by the upload form separately.
 */
export function listKnownCars(): string[] {
  const names = new Set<string>(readRememberedCars());
  for (const session of listLocalSessions()) {
    const car = session.car?.trim();
    if (car) names.add(car);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function listSessionsForCompare(options?: {
  trackId?: string;
  excludeSessionId?: string;
}): StoredSession[] {
  return listLocalSessions().filter((session) => {
    if (options?.excludeSessionId && session.id === options.excludeSessionId) {
      return false;
    }
    if (options?.trackId && session.trackId && session.trackId !== options.trackId) {
      return false;
    }
    return session.laps.length > 0;
  });
}

export function listDrivers(): DriverProfile[] {
  return readDrivers().sort((a, b) => a.name.localeCompare(b.name));
}

export function ensureDriver(name: string): DriverProfile {
  const existing = readDrivers().find(
    (driver) => driver.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing;
  const driver: DriverProfile = {
    id: crypto.randomUUID(),
    name,
    created_at: new Date().toISOString(),
  };
  writeDrivers([...readDrivers(), driver]);
  return driver;
}

export type LeaderboardRow = {
  trackId: string;
  carClass: string;
  driver: string;
  car: string;
  bestMs: number;
  sessionId: string;
  sessionName: string;
  tires?: string;
  weather?: string;
};

export function localLeaderboard(filters?: {
  trackId?: string;
  /** When set, match any of these track ids (preset ↔ community aliases). */
  trackIds?: string[];
  carClass?: string;
  driver?: string;
}): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];
  const trackAllow =
    filters?.trackIds && filters.trackIds.length
      ? new Set(filters.trackIds)
      : filters?.trackId
        ? new Set([filters.trackId])
        : null;
  for (const session of listLocalSessions()) {
    if (!session.trackId || !session.laps.length) continue;
    if (trackAllow && !trackAllow.has(session.trackId)) continue;
    if (filters?.carClass && (session.carClass || "Open") !== filters.carClass) {
      continue;
    }
    if (
      filters?.driver &&
      (session.driver || "Unknown").toLowerCase() !== filters.driver.toLowerCase()
    ) {
      continue;
    }
    const bestMs = Math.min(...session.laps.map((lap) => lap.lap_time_ms));
    rows.push({
      trackId: session.trackId,
      carClass: session.carClass || "Open",
      driver: session.driver || "Unknown",
      car: session.car || "Unknown",
      bestMs,
      sessionId: session.id,
      sessionName: session.name,
      tires: session.tires,
      weather: session.weather,
    });
  }
  return rows.sort((a, b) => a.bestMs - b.bestMs || a.driver.localeCompare(b.driver));
}
