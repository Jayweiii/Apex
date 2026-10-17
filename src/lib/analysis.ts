import { usesTrackDistance, withDistance, valueAt } from "./compare";
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
  /** True when sector splits used map-matched trackDist. */
  snapped?: boolean;
};

/**
 * Cumulative meters from lap start.
 * Prefers snapped trackDist; else haversine GPS; else speed×dt.
 */
export function cumulativeDistance(points: TelemetryPoint[]) {
  return withDistance(points).map((sample) => sample.dist);
}

function timeAtDistance(points: TelemetryPoint[], dist: number) {
  const samples = withDistance(points);
  if (!samples.length) return 0;
  return valueAt(samples, dist, "t");
}

function sectorTimesForLap(points: TelemetryPoint[], sectorCount: number) {
  if (points.length < 2) return Array.from({ length: sectorCount }, () => 0);
  const samples = withDistance(points);
  const total = samples[samples.length - 1]?.dist || 1;
  const times: number[] = [];
  for (let s = 0; s < sectorCount; s += 1) {
    const startD = (total * s) / sectorCount;
    const endD = (total * (s + 1)) / sectorCount;
    const startT = valueAt(samples, startD, "t");
    const endT = valueAt(samples, endD, "t");
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

  const snapped = usable.every((lap) => usesTrackDistance(lap.points));
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
    snapped,
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

/**
 * Corner breakdown aligned on distance from SF.
 * When points include trackDist, apex distances and other-lap matching use
 * snapped centerline meters (same axis as compare delta).
 */
export function cornerBreakdown(
  reference: ParsedLap,
  other?: ParsedLap | null,
): CornerStat[] {
  const distances = cumulativeDistance(reference.points);
  const apexes = findApexes(reference.points, distances);

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
    if (other) {
      // Match other lap at the same along-track distance (snapped when present).
      const startDist = distances[start];
      const endDist = distances[end];
      const otherStartT = timeAtDistance(other.points, startDist);
      const otherEndT = timeAtDistance(other.points, endDist);
      const otherMs = Math.round((otherEndT - otherStartT) * 1000);
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
