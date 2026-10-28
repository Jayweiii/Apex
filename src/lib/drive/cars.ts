/**
 * Arcade car presets for Drive — local game only, not real garage cars.
 */

export type DriveCarId = "miata" | "hatch" | "gt" | "kart";

export type DriveCarPreset = {
  id: DriveCarId;
  name: string;
  blurb: string;
  /** Multiplier on accel. */
  power: number;
  /** Multiplier on brake force. */
  brake: number;
  /** Multiplier on asphalt grip. */
  grip: number;
  /** Multiplier on steer rate. */
  steer: number;
  /** Multiplier on max speed. */
  topSpeed: number;
  /** Visual body color. */
  color: string;
};

export const DRIVE_CARS: DriveCarPreset[] = [
  {
    id: "miata",
    name: "Spec Miata",
    blurb: "Balanced grip and power — the default feel.",
    power: 1,
    brake: 1,
    grip: 1,
    steer: 1,
    topSpeed: 1,
    color: "#f97316",
  },
  {
    id: "hatch",
    name: "Hot Hatch",
    blurb: "Punchy throttle, snaps loose if you ask too much.",
    power: 1.18,
    brake: 0.95,
    grip: 0.9,
    steer: 1.05,
    topSpeed: 1.02,
    color: "#38bdf8",
  },
  {
    id: "gt",
    name: "GT Cup",
    blurb: "Heavy and planted — trusts the tire more.",
    power: 1.28,
    brake: 1.12,
    grip: 1.18,
    steer: 0.88,
    topSpeed: 1.12,
    color: "#a78bfa",
  },
  {
    id: "kart",
    name: "Rental Kart",
    blurb: "Twitchy, low top end — great for learning lines.",
    power: 0.85,
    brake: 1.05,
    grip: 0.95,
    steer: 1.35,
    topSpeed: 0.72,
    color: "#facc15",
  },
];

const CAR_KEY = "apex.drive.selectedCar";

export function getDriveCar(id: string | null | undefined): DriveCarPreset {
  return DRIVE_CARS.find((c) => c.id === id) ?? DRIVE_CARS[0]!;
}

export function loadSelectedCarId(): DriveCarId {
  if (typeof window === "undefined") return "miata";
  try {
    const raw = localStorage.getItem(CAR_KEY);
    if (DRIVE_CARS.some((c) => c.id === raw)) return raw as DriveCarId;
  } catch {
    // ignore
  }
  return "miata";
}

export function saveSelectedCarId(id: DriveCarId) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CAR_KEY, id);
  } catch {
    // ignore
  }
}
