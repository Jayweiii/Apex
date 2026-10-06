import type { DataKind, DatasetAttribution } from "./attribution";
import type { ParsedLap, TelemetryPoint } from "./types";

const STORAGE_KEY = "apex.local-sessions";
const DRIVERS_KEY = "apex.local-drivers";

export type StoredLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
};

export type SessionSourceKind = "csv" | "gopro";

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
  rawObjectKey?: string | null;
  videoObjectKey?: string | null;
  videoLocalKey?: string | null;
  storageBackend?: "r2" | "local" | "idb";
};

export type DriverProfile = {
  id: string;
  name: string;
  created_at: string;
};

function readAll(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredSession[];
    return Array.isArray(parsed) ? parsed : [];
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
  sessions[index] = { ...sessions[index], ...patch };
  writeAll(sessions);
  return sessions[index];
}

export function replaceLocalSessionLaps(
  id: string,
  laps: ParsedLap[],
): StoredSession | null {
  return updateLocalSession(id, {
    laps: laps.map((lap) => ({
      id: crypto.randomUUID(),
      lap_number: lap.lapNumber,
      lap_time_ms: lap.lapTimeMs,
      telemetry: lap.points,
    })),
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
  rawObjectKey?: string | null;
  videoObjectKey?: string | null;
  videoLocalKey?: string | null;
  storageBackend?: "r2" | "local" | "idb";
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
    rawObjectKey: meta?.rawObjectKey ?? null,
    videoObjectKey: meta?.videoObjectKey ?? null,
    videoLocalKey: meta?.videoLocalKey ?? null,
    storageBackend: meta?.storageBackend,
    laps: laps.map((lap) => ({
      id: crypto.randomUUID(),
      lap_number: lap.lapNumber,
      lap_time_ms: lap.lapTimeMs,
      telemetry: lap.points,
    })),
  };
  writeAll([session, ...readAll()]);
  return session;
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
  carClass?: string;
  driver?: string;
}): LeaderboardRow[] {
  const rows: LeaderboardRow[] = [];
  for (const session of listLocalSessions()) {
    if (!session.trackId || !session.laps.length) continue;
    if (filters?.trackId && session.trackId !== filters.trackId) continue;
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
