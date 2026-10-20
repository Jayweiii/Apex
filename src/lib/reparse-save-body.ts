/**
 * Slim re-parse Save payload so full-res source_gps + lap telemetry never
 * blow past Vercel/body limits (the silent Save failure on session 1aa2fb88).
 *
 * When sourceGps is present we omit per-lap point arrays — the server
 * re-splits from source_gps (authoritative) using the same track/SF.
 */
import type { GpsQuality } from "@/lib/gps-quality";
import {
  sourceGpsPayloadBytes,
  type SourceGpsStored,
} from "@/lib/session-reparse";
import type { TelemetryPoint } from "@/lib/types";

/** Soft cap for the whole POST JSON (Vercel serverless ~4.5MB; stay well under). */
export const REPARSE_BODY_MAX_BYTES = 3_500_000;

export type ReparseLapWire = {
  lapNumber: number;
  lapTimeMs: number;
  points?: TelemetryPoint[];
  startOffsetSec?: number;
  startedAtMs?: number;
};

export type ReparseSaveBody = {
  laps?: ReparseLapWire[];
  sourceGps?: SourceGpsStored | null;
  trackId?: string | null;
  startFinish?: { lat: number; lon: number } | null;
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality?: GpsQuality;
};

export function buildReparseSaveBody(input: {
  laps: ReparseLapWire[];
  sourceGps?: SourceGpsStored | null;
  trackId?: string | null;
  startFinish?: { lat: number; lon: number } | null;
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality?: GpsQuality;
}): { body: ReparseSaveBody; bytes: number; slimmed: boolean } {
  const hasSource = Boolean(
    input.sourceGps && sourceGpsPayloadBytes(input.sourceGps) > 0,
  );
  const slimmed = hasSource;
  const body: ReparseSaveBody = {
    sourceGps: input.sourceGps ?? null,
    trackId: input.trackId ?? null,
    startFinish: input.startFinish ?? null,
    startedAtMs: input.startedAtMs,
    sessionDate: input.sessionDate,
    gpsQuality: input.gpsQuality,
  };
  if (slimmed) {
    // Preview-only: times/offsets for diagnostics; server re-splits from GPS.
    body.laps = input.laps.map((lap) => ({
      lapNumber: lap.lapNumber,
      lapTimeMs: lap.lapTimeMs,
      startOffsetSec: lap.startOffsetSec,
      startedAtMs: lap.startedAtMs,
    }));
  } else {
    body.laps = input.laps;
  }
  const bytes = JSON.stringify(body).length;
  return { body, bytes, slimmed };
}

export function reparseBodyTooLargeMessage(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `Re-parse Save payload is too large (${mb} MB). Re-select the GPS file so source_gps is compact, then Save again — or try without attaching full lap telemetry.`;
}
