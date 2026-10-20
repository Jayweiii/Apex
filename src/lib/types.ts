export type TelemetryPoint = {
  t: number;
  speed: number;
  lat?: number;
  lon?: number;
  /** Altitude in meters (GPS / baro), when present. */
  alt?: number;
  /** Lateral acceleration in g. Positive is left. */
  latG?: number;
  /** Longitudinal acceleration in g. Positive is acceleration, negative is braking. */
  lonG?: number;
  /** Combined acceleration in g. */
  g?: number;
  /** Throttle pedal position 0–100%. */
  throttle?: number;
  /** Brake pedal / calculated brake 0–100%. */
  brake?: number;
  /** Steering wheel angle in degrees. */
  steering?: number;
  /** Engine RPM. */
  rpm?: number;
  /** Gear number (0 = neutral, negative = reverse). */
  gear?: number;
  /** Heading / course in degrees. */
  heading?: number;
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
  /** Original pasted URL when known (optional). */
  youtubeUrl?: string;
  objectKey?: string;
  localKey?: string;
  title?: string;
  /**
   * Lap this clip covers (single-lap onboards).
   * Null / undefined = session-level video spanning many laps; offset applies
   * at each lap start via start_offset_sec.
   */
  lapId?: string | null;
  /** 1-based lap_number for bulk paste; kept in sync with lapId when set. */
  lapIndex?: number | null;
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
  /** When true, ignored for best-lap stats / leaderboards / default compare. */
  excluded?: boolean | null;
  exclude_reason?: string | null;
  /** Absolute session-time start override (seconds); null = auto. */
  start_offset_override?: number | null;
  /** Absolute session-time end override (seconds); null = auto. */
  end_offset_override?: number | null;
};
