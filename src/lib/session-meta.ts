import type { SessionRow } from "./types";
import type { DatasetAttribution } from "./attribution";

export type SessionSourceKind = "csv" | "gopro" | "logger";

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
  options?: {
    /** Prefer lap number for ?lap=N share URLs. */
    lapNumber?: number;
    /** Legacy: UUID still resolves on the session page. */
    lapId?: string;
    ref?: string;
    other?: string;
    videoId?: string;
    videoTime?: number;
  },
): ShareTargets {
  const sessionPath = `/sessions/${sessionId}`;
  let lapPath: string | undefined;
  const lapKey =
    options?.lapNumber != null
      ? String(options.lapNumber)
      : options?.lapId
        ? options.lapId
        : null;
  if (lapKey) {
    const params = new URLSearchParams();
    params.set("lap", lapKey);
    if (options?.videoId) params.set("v", options.videoId);
    if (options?.videoTime != null) params.set("t", String(options.videoTime));
    lapPath = `/sessions/${sessionId}?${params.toString()}`;
  }
  return {
    sessionPath,
    lapPath,
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
