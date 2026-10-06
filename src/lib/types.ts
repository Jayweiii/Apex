export type TelemetryPoint = {
  t: number;
  speed: number;
  lat?: number;
  lon?: number;
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
};

export type LapRow = {
  id: string;
  session_id: string;
  user_id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry: TelemetryPoint[];
};
