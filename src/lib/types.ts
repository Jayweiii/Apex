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
};

export type ParsedLap = {
  lapNumber: number;
  lapTimeMs: number;
  points: TelemetryPoint[];
};

export type SessionRow = {
  id: string;
  user_id: string;
  name: string;
  filename: string | null;
  created_at: string;
  track_id?: string | null;
  track_name?: string | null;
  car?: string | null;
};

export type LapRow = {
  id: string;
  session_id: string;
  user_id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
};
