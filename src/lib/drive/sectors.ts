/**
 * Equal-distance sector splits + live delta vs a reference ghost/PB.
 */

import type { DriveGhostLap, DrivePoint } from "@/lib/drive/types";
import { pathLength } from "@/lib/drive/coords";

export const DRIVE_SECTOR_COUNT = 3;

export type SectorSplit = {
  /** Along-track meters where this sector ends (exclusive of next). */
  endAlongM: number;
};

export function buildSectorSplits(
  centerline: DrivePoint[],
  count = DRIVE_SECTOR_COUNT,
): SectorSplit[] {
  const len = Math.max(1, pathLength(centerline));
  const splits: SectorSplit[] = [];
  for (let i = 1; i <= count; i += 1) {
    splits.push({ endAlongM: (len * i) / count });
  }
  return splits;
}

export function sectorIndexForAlong(
  alongM: number,
  startAlongM: number,
  trackLengthM: number,
  splits: SectorSplit[],
): number {
  const len = Math.max(1, trackLengthM);
  let delta = alongM - startAlongM;
  while (delta < 0) delta += len;
  while (delta >= len) delta -= len;
  for (let i = 0; i < splits.length; i += 1) {
    if (delta < splits[i]!.endAlongM) return i;
  }
  return Math.max(0, splits.length - 1);
}

/** Distance covered from lap start along the ribbon (wrapped). */
export function alongFromStart(
  alongM: number,
  startAlongM: number,
  trackLengthM: number,
): number {
  const len = Math.max(1, trackLengthM);
  let delta = alongM - startAlongM;
  while (delta < 0) delta += len;
  while (delta >= len) delta -= len;
  return delta;
}

/**
 * Estimate reference ghost elapsed ms when it was at the same along-track
 * distance from its first sample. Uses sample.t when present.
 */
export function ghostTimeAtAlong(
  ghost: DriveGhostLap,
  centerline: DrivePoint[],
  startAlongM: number,
  targetAlongFromStart: number,
  projectAlong: (x: number, y: number) => number,
): number | null {
  const samples = ghost.samples;
  if (samples.length < 2) return null;
  const len = Math.max(1, pathLength(centerline));
  const alongs: number[] = samples.map((s) => {
    const a = projectAlong(s.x, s.y);
    return alongFromStart(a, startAlongM, len);
  });
  // Prefer samples that advance along the lap
  for (let i = 1; i < samples.length; i += 1) {
    const a0 = alongs[i - 1]!;
    const a1 = alongs[i]!;
    if (a1 < a0 - len * 0.25) continue; // wrap noise
    if (targetAlongFromStart >= a0 && targetAlongFromStart <= a1) {
      const span = a1 - a0 || 1e-6;
      const u = (targetAlongFromStart - a0) / span;
      const t0 = samples[i - 1]!.t ?? 0;
      const t1 = samples[i]!.t ?? t0;
      return t0 + (t1 - t0) * u;
    }
  }
  // Past last sample
  const last = samples[samples.length - 1]!;
  if (targetAlongFromStart >= (alongs[alongs.length - 1] ?? 0)) {
    return last.t ?? ghost.timeMs;
  }
  return samples[0]!.t ?? 0;
}

export function formatDeltaMs(deltaMs: number): string {
  const sign = deltaMs >= 0 ? "+" : "−";
  const abs = Math.abs(deltaMs) / 1000;
  return `${sign}${abs.toFixed(2)}`;
}
