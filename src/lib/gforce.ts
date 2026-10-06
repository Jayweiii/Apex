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

export function enrichTelemetry(points: TelemetryPoint[]): AcceleratedPoint[] {
  if (points.length === 0) return [];

  const loggedLateral = points.some((point) => point.latG != null);
  const loggedLongitudinal = points.some((point) => point.lonG != null);
  if (loggedLateral || loggedLongitudinal) {
    return points.map((point) => {
      const latG = point.latG ?? 0;
      const lonG = point.lonG ?? 0;
      return { ...point, latG, lonG, g: Math.hypot(latG, lonG) };
    });
  }

  const derived = points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const dt = next.t - prev.t;
    const lonG =
      dt > 0.02 ? (next.speed / 3.6 - prev.speed / 3.6) / dt / GRAVITY : 0;

    let latG = 0;
    const hasSegment =
      index > 0 &&
      index < points.length - 1 &&
      dt > 0.02 &&
      prev.lat != null &&
      prev.lon != null &&
      point.lat != null &&
      point.lon != null &&
      next.lat != null &&
      next.lon != null;
    if (hasSegment) {
      const headingIn = bearing(prev.lat, prev.lon, point.lat, point.lon);
      const headingOut = bearing(point.lat, point.lon, next.lat, next.lon);
      const yawRate = wrapPi(headingOut - headingIn) / dt;
      latG = ((point.speed / 3.6) * yawRate) / GRAVITY;
    }

    return {
      ...point,
      latG,
      lonG,
      g: Math.hypot(latG, lonG),
    };
  });

  if (derived.length > 2) {
    derived[0] = { ...derived[0], latG: derived[1].latG, lonG: derived[1].lonG };
    const last = derived.length - 1;
    derived[last] = {
      ...derived[last],
      latG: derived[last - 1].latG,
      lonG: derived[last - 1].lonG,
    };
  }

  return smooth(derived);
}
