import type { TelemetryPoint } from "./types";

/** Channels that may appear in the stacked telemetry panel. */
export type TelemetryChannelId =
  | "speed"
  | "delta"
  | "throttleBrake"
  | "steering"
  | "g"
  | "gearRpm"
  | "heading";

export type TelemetryChannelDef = {
  id: TelemetryChannelId;
  label: string;
};

/** Display order for stacked charts (top → bottom). */
export const TELEMETRY_CHANNEL_ORDER: TelemetryChannelDef[] = [
  { id: "speed", label: "Speed" },
  { id: "delta", label: "Delta" },
  { id: "throttleBrake", label: "Throttle / Brake" },
  { id: "steering", label: "Steering" },
  { id: "g", label: "G-force" },
  { id: "gearRpm", label: "Gear / RPM" },
  { id: "heading", label: "Heading" },
];

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** True when any sample carries a usable value for this field. */
export function pointsHaveField(
  points: TelemetryPoint[] | null | undefined,
  field: keyof TelemetryPoint,
): boolean {
  if (!points?.length) return false;
  return points.some((point) => finite(point[field]));
}

/**
 * Channels available for a single lap after enrichment.
 * Speed always shows when samples exist; G shows when lat/lon G exist
 * (logged or derived). Optional OBD/GPS channels only when logged.
 */
export function detectLapChannels(
  points: TelemetryPoint[] | null | undefined,
): TelemetryChannelId[] {
  if (!points?.length) return [];
  const ids: TelemetryChannelId[] = ["speed"];
  if (pointsHaveField(points, "throttle") || pointsHaveField(points, "brake")) {
    ids.push("throttleBrake");
  }
  if (pointsHaveField(points, "steering")) ids.push("steering");
  if (pointsHaveField(points, "latG") || pointsHaveField(points, "lonG") || pointsHaveField(points, "g")) {
    ids.push("g");
  }
  if (pointsHaveField(points, "gear") || pointsHaveField(points, "rpm")) {
    ids.push("gearRpm");
  }
  if (pointsHaveField(points, "heading")) ids.push("heading");
  return TELEMETRY_CHANNEL_ORDER.map((c) => c.id).filter((id) =>
    ids.includes(id),
  );
}

/**
 * Channels for multi-lap compare. Delta requires ≥2 laps.
 * Optional channels appear when any compared lap has the field.
 */
export function detectCompareChannels(
  laps: TelemetryPoint[][],
  options: { includeDelta?: boolean } = {},
): TelemetryChannelId[] {
  const includeDelta = options.includeDelta !== false && laps.length >= 2;
  const flat = laps.flat();
  if (!flat.length) return [];
  const ids: TelemetryChannelId[] = ["speed"];
  if (includeDelta) ids.push("delta");
  if (pointsHaveField(flat, "throttle") || pointsHaveField(flat, "brake")) {
    ids.push("throttleBrake");
  }
  if (pointsHaveField(flat, "steering")) ids.push("steering");
  if (
    pointsHaveField(flat, "latG") ||
    pointsHaveField(flat, "lonG") ||
    pointsHaveField(flat, "g")
  ) {
    ids.push("g");
  }
  if (pointsHaveField(flat, "gear") || pointsHaveField(flat, "rpm")) {
    ids.push("gearRpm");
  }
  if (pointsHaveField(flat, "heading")) ids.push("heading");
  return TELEMETRY_CHANNEL_ORDER.map((c) => c.id).filter((id) =>
    ids.includes(id),
  );
}

export function channelLabel(id: TelemetryChannelId): string {
  return TELEMETRY_CHANNEL_ORDER.find((c) => c.id === id)?.label ?? id;
}
