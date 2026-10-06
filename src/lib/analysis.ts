import type { ParsedLap, TelemetryPoint } from "./types";

export type SectorResult = {
  index: number;
  bestMs: number;
  bestLapNumber: number;
  timesMs: { lapNumber: number; ms: number }[];
};

export type TheoreticalBest = {
  sectorCount: number;
  theoreticalMs: number;
  actualBestMs: number;
  gapMs: number;
  sectors: SectorResult[];
};

function cumulativeDistance(points: TelemetryPoint[]) {
  const dist = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) {
      dist.push(dist[i - 1] + Math.max(0, (b.t - a.t) * ((a.speed + b.speed) / 2 / 3.6)));
      continue;
    }
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const aa =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    const meters = 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(aa)));
    dist.push(dist[i - 1] + meters);
  }
  return dist;
}

function sectorTimesForLap(points: TelemetryPoint[], sectorCount: number) {
  if (points.length < 2) return Array.from({ length: sectorCount }, () => 0);
  const distances = cumulativeDistance(points);
  const total = distances[distances.length - 1] || 1;
  const times: number[] = [];
  for (let s = 0; s < sectorCount; s += 1) {
    const startD = (total * s) / sectorCount;
    const endD = (total * (s + 1)) / sectorCount;
    let startT = points[0].t;
    let endT = points[points.length - 1].t;
    for (let i = 0; i < distances.length; i += 1) {
      if (distances[i] >= startD) {
        startT = points[i].t;
        break;
      }
    }
    for (let i = 0; i < distances.length; i += 1) {
      if (distances[i] >= endD) {
        endT = points[i].t;
        break;
      }
    }
    times.push(Math.max(0, (endT - startT) * 1000));
  }
  return times;
}

export function theoreticalBestLap(
  laps: ParsedLap[],
  sectorCount = 12,
): TheoreticalBest | null {
  const usable = laps.filter((lap) => lap.points.length >= 8 && lap.lapTimeMs >= 1000);
  if (!usable.length) return null;

  const sectors: SectorResult[] = [];
  for (let s = 0; s < sectorCount; s += 1) {
    const timesMs = usable.map((lap) => ({
      lapNumber: lap.lapNumber,
      ms: sectorTimesForLap(lap.points, sectorCount)[s] ?? 0,
    }));
    const best = [...timesMs].sort((a, b) => a.ms - b.ms)[0];
    sectors.push({
      index: s + 1,
      bestMs: best.ms,
      bestLapNumber: best.lapNumber,
      timesMs,
    });
  }

  const theoreticalMs = Math.round(sectors.reduce((sum, sector) => sum + sector.bestMs, 0));
  const actualBestMs = Math.min(...usable.map((lap) => lap.lapTimeMs));
  return {
    sectorCount,
    theoreticalMs,
    actualBestMs,
    gapMs: Math.max(0, actualBestMs - theoreticalMs),
    sectors,
  };
}

export type CornerStat = {
  index: number;
  label: string;
  apexDistM: number;
  brakeSpeed: number;
  minSpeed: number;
  exitSpeed: number;
  timeMs: number;
  deltaMs: number | null;
};

function findApexes(points: TelemetryPoint[], distances: number[]) {
  const apexes: number[] = [];
  const window = Math.max(3, Math.floor(points.length / 40));
  for (let i = window; i < points.length - window; i += 1) {
    const speed = points[i].speed;
    let isMin = true;
    for (let j = i - window; j <= i + window; j += 1) {
      if (points[j].speed < speed) {
        isMin = false;
        break;
      }
    }
    if (isMin && speed < 120) {
      if (!apexes.length || distances[i] - distances[apexes[apexes.length - 1]] > 80) {
        apexes.push(i);
      }
    }
  }
  return apexes.slice(0, 16);
}

export function cornerBreakdown(
  reference: ParsedLap,
  other?: ParsedLap | null,
): CornerStat[] {
  const distances = cumulativeDistance(reference.points);
  const apexes = findApexes(reference.points, distances);
  const otherDistances = other ? cumulativeDistance(other.points) : null;

  return apexes.map((apexIndex, index) => {
    const start = Math.max(0, apexIndex - Math.floor(reference.points.length / 30));
    const end = Math.min(
      reference.points.length - 1,
      apexIndex + Math.floor(reference.points.length / 30),
    );
    const region = reference.points.slice(start, end + 1);
    const brakeSpeed = Math.max(...region.slice(0, Math.max(1, apexIndex - start + 1)).map((p) => p.speed));
    const minSpeed = reference.points[apexIndex].speed;
    const exitSpeed = Math.max(
      ...region.slice(apexIndex - start).map((p) => p.speed),
      minSpeed,
    );
    const timeMs = Math.round((reference.points[end].t - reference.points[start].t) * 1000);

    let deltaMs: number | null = null;
    if (other && otherDistances) {
      const target = distances[apexIndex];
      let otherApex = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i < otherDistances.length; i += 1) {
        const d = Math.abs(otherDistances[i] - target);
        if (d < best) {
          best = d;
          otherApex = i;
        }
      }
      const oStart = Math.max(0, otherApex - Math.floor(other.points.length / 30));
      const oEnd = Math.min(
        other.points.length - 1,
        otherApex + Math.floor(other.points.length / 30),
      );
      const otherMs = Math.round((other.points[oEnd].t - other.points[oStart].t) * 1000);
      deltaMs = otherMs - timeMs;
    }

    return {
      index: index + 1,
      label: `T${index + 1}`,
      apexDistM: Number(distances[apexIndex].toFixed(1)),
      brakeSpeed: Number(brakeSpeed.toFixed(1)),
      minSpeed: Number(minSpeed.toFixed(1)),
      exitSpeed: Number(exitSpeed.toFixed(1)),
      timeMs,
      deltaMs,
    };
  });
}
