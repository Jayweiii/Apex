import type { TelemetryPoint } from "./types";

const GRAVITY = 9.80665;

export type AcceleratedPoint = TelemetryPoint & {
  latG: number;
  lonG: number;
  g: number;
};

function wrapPi(angle: number) {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function wrapDeg180(angle: number) {
  let value = angle;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return Math.atan2(y, x);
}

function smooth(points: AcceleratedPoint[], radius = 2): AcceleratedPoint[] {
  return points.map((point, index) => {
    let latG = 0;
    let lonG = 0;
    let count = 0;
    for (let cursor = index - radius; cursor <= index + radius; cursor += 1) {
      if (cursor < 0 || cursor >= points.length) continue;
      latG += points[cursor].latG;
      lonG += points[cursor].lonG;
      count += 1;
    }
    const lateral = latG / count;
    const longitudinal = lonG / count;
    return {
      ...point,
      latG: lateral,
      lonG: longitudinal,
      g: Math.hypot(lateral, longitudinal),
    };
  });
}

function hasFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * True when the series already carries usable logged accelerometer samples
 * (not just sparse / near-zero placeholders). Weak logs fall through to derive.
 */
function hasUsableLoggedG(points: TelemetryPoint[]): {
  lateral: boolean;
  longitudinal: boolean;
} {
  let latCount = 0;
  let lonCount = 0;
  let latAbs = 0;
  let lonAbs = 0;
  for (const point of points) {
    if (hasFinite(point.latG)) {
      latCount += 1;
      latAbs += Math.abs(point.latG);
    }
    if (hasFinite(point.lonG)) {
      lonCount += 1;
      lonAbs += Math.abs(point.lonG);
    }
  }
  const minSamples = Math.max(3, Math.floor(points.length * 0.2));
  return {
    lateral: latCount >= minSamples && latAbs / Math.max(1, latCount) > 0.02,
    longitudinal: lonCount >= minSamples && lonAbs / Math.max(1, lonCount) > 0.02,
  };
}

function deriveLonG(prev: TelemetryPoint, next: TelemetryPoint): number {
  const dt = next.t - prev.t;
  if (dt <= 0.02) return 0;
  return (next.speed / 3.6 - prev.speed / 3.6) / dt / GRAVITY;
}

/**
 * Lateral G from yaw-rate: a = v * ω.
 * Prefer logged heading; else GPS track bearing (skip duplicate fixes).
 */
function deriveLatG(
  points: TelemetryPoint[],
  index: number,
  prev: TelemetryPoint,
  next: TelemetryPoint,
): number {
  const point = points[index];
  const dt = next.t - prev.t;
  if (dt <= 0.02) return 0;
  const v = point.speed / 3.6;

  if (hasFinite(prev.heading) && hasFinite(next.heading)) {
    const dHeading = wrapDeg180(next.heading - prev.heading);
    const yawRate = (dHeading * Math.PI) / 180 / dt;
    return (v * yawRate) / GRAVITY;
  }

  // Walk past duplicate GPS fixes (ACCL/GPS rate mismatch) to find motion.
  if (!hasFinite(point.lat) || !hasFinite(point.lon)) return 0;

  let before = Math.max(0, index - 1);
  while (
    before > 0 &&
    hasFinite(points[before].lat) &&
    hasFinite(points[before].lon) &&
    Math.abs(points[before].lat! - point.lat) < 1e-7 &&
    Math.abs(points[before].lon! - point.lon) < 1e-7
  ) {
    before -= 1;
  }
  let after = Math.min(points.length - 1, index + 1);
  while (
    after < points.length - 1 &&
    hasFinite(points[after].lat) &&
    hasFinite(points[after].lon) &&
    Math.abs(points[after].lat! - point.lat) < 1e-7 &&
    Math.abs(points[after].lon! - point.lon) < 1e-7
  ) {
    after += 1;
  }

  const a = points[before];
  const b = points[after];
  if (!a || !b || before === after) return 0;
  const windowDt = b.t - a.t;
  if (
    windowDt > 0.05 &&
    hasFinite(a.lat) &&
    hasFinite(a.lon) &&
    hasFinite(point.lat) &&
    hasFinite(point.lon) &&
    hasFinite(b.lat) &&
    hasFinite(b.lon)
  ) {
    const movedIn =
      Math.abs(a.lat - point.lat) > 1e-7 || Math.abs(a.lon - point.lon) > 1e-7;
    const movedOut =
      Math.abs(point.lat - b.lat) > 1e-7 || Math.abs(point.lon - b.lon) > 1e-7;
    // If this sample is itself a duplicate island, use a→b chord for yaw.
    if (movedIn && movedOut) {
      const headingIn = bearing(a.lat, a.lon, point.lat, point.lon);
      const headingOut = bearing(point.lat, point.lon, b.lat, b.lon);
      const yawRate = wrapPi(headingOut - headingIn) / windowDt;
      return (v * yawRate) / GRAVITY;
    }
    if (before > 0 && after < points.length - 1) {
      const pre = points[Math.max(0, before - 1)];
      if (
        hasFinite(pre.lat) &&
        hasFinite(pre.lon) &&
        (Math.abs(pre.lat - a.lat) > 1e-7 || Math.abs(pre.lon - a.lon) > 1e-7)
      ) {
        const headingIn = bearing(pre.lat, pre.lon, a.lat, a.lon);
        const headingOut = bearing(a.lat, a.lon, b.lat, b.lon);
        const yawRate = wrapPi(headingOut - headingIn) / windowDt;
        return (v * yawRate) / GRAVITY;
      }
    }
  }

  return 0;
}

/**
 * Ensure every sample has latG / lonG / g.
 * Prefer logged ACCL / CSV accel when usable; otherwise:
 *   long G = d(v)/dt / g
 *   lat G  = v * yaw-rate (heading or GPS bearing), then smoothed.
 */
export function enrichTelemetry(points: TelemetryPoint[]): AcceleratedPoint[] {
  if (points.length === 0) return [];

  const logged = hasUsableLoggedG(points);
  if (logged.lateral && logged.longitudinal) {
    return points.map((point) => {
      const latG = point.latG ?? 0;
      const lonG = point.lonG ?? 0;
      return { ...point, latG, lonG, g: Math.hypot(latG, lonG) };
    });
  }

  const derived = points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];

    const lonG = logged.longitudinal
      ? (point.lonG ?? 0)
      : deriveLonG(prev, next);
    const latG = logged.lateral
      ? (point.latG ?? 0)
      : deriveLatG(points, index, prev, next);

    return {
      ...point,
      latG,
      lonG,
      g: Math.hypot(latG, lonG),
    };
  });

  if (derived.length > 2) {
    derived[0] = {
      ...derived[0],
      latG: derived[1].latG,
      lonG: derived[1].lonG,
      g: Math.hypot(derived[1].latG, derived[1].lonG),
    };
    const last = derived.length - 1;
    derived[last] = {
      ...derived[last],
      latG: derived[last - 1].latG,
      lonG: derived[last - 1].lonG,
      g: Math.hypot(derived[last - 1].latG, derived[last - 1].lonG),
    };
  }

  if (!logged.lateral && !logged.longitudinal) {
    return smooth(derived, 2);
  }
  if (!logged.lateral || !logged.longitudinal) {
    const smoothed = smooth(derived, 2);
    return smoothed.map((point, index) => {
      const latG = logged.lateral ? derived[index].latG : point.latG;
      const lonG = logged.longitudinal ? derived[index].lonG : point.lonG;
      return { ...point, latG, lonG, g: Math.hypot(latG, lonG) };
    });
  }
  return derived;
}
