import type {
  DriveCameraMode,
  DriveCarState,
  DriveGhostLap,
  DrivePoint,
} from "@/lib/drive/types";

/** Mutable snapshot read by the R3F scene each frame (no React re-renders). */
export type DriveSimSnapshot = {
  car: DriveCarState;
  camera: DriveCameraMode;
  ghosts: Array<{ sample: DrivePoint; heading: number; color: string }>;
  /** SF gate endpoints in ENU for 3D markers. */
  gate: { a: DrivePoint; b: DrivePoint } | null;
};

export function createSimSnapshot(car: DriveCarState): DriveSimSnapshot {
  return {
    car,
    camera: "chase",
    ghosts: [],
    gate: null,
  };
}

export type GhostDraw = {
  g: DriveGhostLap;
  color: string;
};
