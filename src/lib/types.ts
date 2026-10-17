export type TelemetryPoint = {
  t: number;
  speed: number;
  lat?: number;
  lon?: number;
  /** Lateral acceleration in g. Positive is left. */
  latG?: number;
  /** Longitudinal acceleration in g. Positive is acceleration, negative is braking. */
  lonG?: number;
  /** Combined acceleration in g. */
  g?: number;
  /** Distance along track centerline (meters), when map-matched. */
  trackDist?: number;
  /** Signed lateral offset from centerline (meters), when map-matched. */
  lateralOffset?: number;
  /** Original GPS latitude before snapping. */
  rawLat?: number;
  /** Original GPS longitude before snapping. */
  rawLon?: number;
};

export type ParsedLap = {
  lapNumber: number;
  lapTimeMs: number;
  points: TelemetryPoint[];
  /** Seconds from session start to this lap's first sample. */
  startOffsetSec?: number;
  /** Epoch ms of this lap's first sample, when absolute time is known. */
  startedAtMs?: number;
};

export type VideoSyncSource =
  | "unsynced"
  | "manual"
  | "time_of_day"
  | "lap_match"
  | "auto";

/**
 * Attached onboard clip. Session timeline:
 * videoTime = offsetSec + rate * sessionTime
 * sessionTime = lap.start_offset_sec + point.t
 */
export type SessionVideo = {
  id: string;
  provider: "youtube" | "mp4";
  youtubeId?: string;
  objectKey?: string;
  localKey?: string;
  title?: string;
  /** Lap this clip covers (single-lap onboards). */
  lapId?: string | null;
  offsetSec: number;
  rate?: number;
  syncSource: VideoSyncSource;
  /** Absolute clock at video t=0, when known. */
  videoStartedAtMs?: number;
};

export type SessionRow = {
  id: string;
  user_id: string;
  name: string;
  filename: string | null;
  created_at: string;
  visibility?: "private" | "friends" | "public" | null;
  track_id?: string | null;
  car?: string | null;
  driver_name?: string | null;
};

export type LapRow = {
  id: string;
  session_id: string;
  user_id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
  start_offset_sec?: number | null;
  started_at_ms?: number | null;
};
