import type { DataKind, DatasetAttribution } from "./attribution";
import type { ParsedLap, TelemetryPoint } from "./types";

const STORAGE_KEY = "apex.local-sessions";

export type StoredLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
};

export type StoredSession = {
  id: string;
  name: string;
  filename: string | null;
  created_at: string;
  laps: StoredLap[];
  trackId?: string;
  car?: string;
  kind?: DataKind;
  attribution?: DatasetAttribution;
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

export function listLocalSessions(): StoredSession[] {
  return readAll().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getLocalSession(id: string): StoredSession | null {
  return readAll().find((session) => session.id === id) ?? null;
}

export function saveLocalSession(
  name: string,
  filename: string | null,
  laps: ParsedLap[],
  meta?: { trackId?: string; car?: string },
): StoredSession {
  const session: StoredSession = {
    id: crypto.randomUUID(),
    name,
    filename,
    created_at: new Date().toISOString(),
    trackId: meta?.trackId,
    car: meta?.car,
    kind: "upload",
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
