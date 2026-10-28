/** Drive minigame types — game times must NEVER enter real lap leaderboards. */

export type DriveLatLon = { lat: number; lon: number };

export type DrivePoint = {
  /** East meters from track origin. */
  x: number;
  /** North meters from track origin. */
  y: number;
  /**
   * Relative elevation (meters above track minimum).
   * From session GPS altitude when available; else 0 (flat fallback).
   */
  z?: number;
  /** Optional elapsed ms along a ghost/recording. */
  t?: number;
};

export type DriveStartFinish = {
  lat: number;
  lon: number;
  headingDeg?: number;
  a?: DriveLatLon;
  b?: DriveLatLon;
};

export type DriveGhostLap = {
  /** Source label shown in HUD (e.g. "Your best", "Real L12 1:52.3"). */
  label: string;
  kind: "player" | "real";
  timeMs: number;
  /** Samples in local meters; t is ms from lap start. */
  samples: DrivePoint[];
};

export type DriveTrackPayload = {
  trackId: string;
  name: string;
  location: string;
  /** Origin used for local ENU projection. */
  origin: DriveLatLon;
  /** Centerline GPS → local meters (closed or open). */
  centerline: DrivePoint[];
  /** Half-width of driveable asphalt (meters). */
  halfWidthM: number;
  startFinish: DriveStartFinish;
  /** Optional real-session ghost to race. */
  realGhost: DriveGhostLap | null;
  /** How the ribbon path was sourced. */
  source: "session_gps" | "centerline" | "builtin";
  /** True when centerline carries smoothed GPS altitude. */
  hasElevation?: boolean;
};

export type DriveInputs = {
  throttle: number;
  brake: number;
  steer: number;
};

export type DriveSurface = "asphalt" | "curb" | "grass";

export type DriveWheelId = "fl" | "fr" | "rl" | "rr";

export type DriveCarState = {
  x: number;
  y: number;
  /** World height (m) at contact patch / body reference. */
  z?: number;
  /** Radians, 0 = north, clockwise-positive matching atan2(east, north). */
  heading: number;
  speed: number;
  /** Lateral slip velocity (m/s), for slide feel. */
  slip: number;
  onTrack: boolean;
  /** Current surface under the car. */
  surface?: DriveSurface;
  /** Smoothed throttle pedal 0–1 for response feel. */
  throttlePedal?: number;
  /** Smoothed brake pedal 0–1. */
  brakePedal?: number;
  /** Longitudinal weight-transfer proxy (−1 front … +1 rear). */
  load?: number;
  /** Body pitch (rad): nose-down negative under braking. */
  pitch?: number;
  /** Body roll (rad): positive = right side down. */
  roll?: number;
  /** Per-wheel spring compression (m), order FL FR RL RR. */
  wheelTravel?: [number, number, number, number];
  /** Per-wheel normal load (N), order FL FR RL RR. */
  wheelLoadN?: [number, number, number, number];
  /** Longitudinal accel estimate (m/s²) for suspension/audio. */
  longAccel?: number;
  /** Lateral accel estimate (m/s²). */
  latAccel?: number;
};

export type DriveCameraMode = "chase" | "top";

export type DrivePhase =
  | "ready"
  | "countdown"
  | "racing"
  | "paused"
  | "celebrating";
