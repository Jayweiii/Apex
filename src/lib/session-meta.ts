import type { SessionRow } from "./types";
import type { DatasetAttribution } from "./attribution";

export type SessionSourceKind = "csv" | "gopro";

export type SessionMeta = {
  track_id?: string | null;
  car?: string | null;
  car_class?: string | null;
  car_tags?: string[] | null;
  driver_name?: string | null;
  weather?: string | null;
  tires?: string | null;
  notes?: string | null;
  source_kind?: SessionSourceKind | null;
  raw_object_key?: string | null;
  video_object_key?: string | null;
  storage_backend?: string | null;
};

export type SessionRowExtended = SessionRow & SessionMeta;

export type ShareTargets = {
  sessionPath: string;
  lapPath?: string;
  comparePath?: string;
};

export function sessionSharePaths(
  sessionId: string,
  options?: { lapId?: string; ref?: string; other?: string },
): ShareTargets {
  const sessionPath = `/sessions/${sessionId}`;
  return {
    sessionPath,
    lapPath: options?.lapId
      ? `/sessions/${sessionId}/laps/${options.lapId}`
      : undefined,
    comparePath:
      options?.ref && options?.other
        ? `/sessions/${sessionId}/compare?ref=${encodeURIComponent(options.ref)}&other=${encodeURIComponent(options.other)}`
        : undefined,
  };
}

export function absoluteShareUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export type PublicCatalogAttribution = DatasetAttribution;
