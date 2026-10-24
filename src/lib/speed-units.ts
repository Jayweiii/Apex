/**
 * Preferred speed display unit. Telemetry stays km/h internally;
 * UI converts at the edge. Default: mph (US track-day default).
 */
export type SpeedUnit = "mph" | "kmh";

export const SPEED_UNIT_KEY = "apex.speed-unit";
export const SPEED_UNIT_EVENT = "apex:speed-unit";
export const DEFAULT_SPEED_UNIT: SpeedUnit = "mph";

const KMH_PER_MPH = 1.60934;

export function parseSpeedUnit(value: unknown): SpeedUnit {
  return value === "kmh" ? "kmh" : "mph";
}

export function readSpeedUnit(): SpeedUnit {
  if (typeof window === "undefined") return DEFAULT_SPEED_UNIT;
  try {
    return parseSpeedUnit(window.localStorage.getItem(SPEED_UNIT_KEY));
  } catch {
    return DEFAULT_SPEED_UNIT;
  }
}

export function writeSpeedUnit(unit: SpeedUnit) {
  if (typeof window === "undefined") return;
  const next = parseSpeedUnit(unit);
  try {
    window.localStorage.setItem(SPEED_UNIT_KEY, next);
  } catch {
    // ignore quota / private mode
  }
  window.dispatchEvent(
    new CustomEvent<SpeedUnit>(SPEED_UNIT_EVENT, { detail: next }),
  );
}

/** Convert stored km/h → display number. */
export function kmhToDisplay(kmh: number, unit: SpeedUnit = readSpeedUnit()): number {
  if (!Number.isFinite(kmh)) return Number.NaN;
  return unit === "mph" ? kmh / KMH_PER_MPH : kmh;
}

export function speedUnitSuffix(unit: SpeedUnit): string {
  return unit === "mph" ? "mph" : "km/h";
}

/** Format a km/h telemetry value in the preferred unit. */
export function formatSpeed(
  kmh: number,
  unit: SpeedUnit = DEFAULT_SPEED_UNIT,
  digits = 0,
): string {
  if (!Number.isFinite(kmh)) return "—";
  const value = kmhToDisplay(kmh, unit);
  return `${value.toFixed(digits)} ${speedUnitSuffix(unit)}`;
}
