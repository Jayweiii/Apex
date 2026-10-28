import type { DrivePoint } from "@/lib/drive/types";

/** Moving-average + clamp outlier filter for GPS altitude (meters ASL → relative). */
export function smoothElevations(
  rawAlt: Array<number | undefined | null>,
  window = 7,
): number[] {
  const n = rawAlt.length;
  if (n === 0) return [];
  const filled: number[] = new Array(n);
  let last = 0;
  let have = false;
  for (let i = 0; i < n; i += 1) {
    const v = rawAlt[i];
    if (typeof v === "number" && Number.isFinite(v)) {
      last = v;
      have = true;
      filled[i] = v;
    } else {
      filled[i] = have ? last : 0;
    }
  }
  if (!have) return filled.map(() => 0);

  const half = Math.max(1, Math.floor(window / 2));
  const smoothed: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j += 1) {
      if (j < 0 || j >= n) continue;
      sum += filled[j]!;
      count += 1;
    }
    smoothed[i] = sum / Math.max(1, count);
  }

  for (let i = 1; i < n - 1; i += 1) {
    const a = smoothed[i - 1]!;
    const b = smoothed[i]!;
    const c = smoothed[i + 1]!;
    const mid = (a + c) * 0.5;
    if (Math.abs(b - mid) > 8) smoothed[i] = mid;
  }

  const min = Math.min(...smoothed);
  return smoothed.map((z) => z - min);
}

/** Attach relative elevation `z` onto local-meter centerline points. */
export function withElevation(
  points: DrivePoint[],
  altAsl: Array<number | undefined | null>,
): DrivePoint[] {
  if (!points.length) return points;
  const zs = smoothElevations(
    altAsl.length === points.length
      ? altAsl
      : resampleAlt(altAsl, points.length),
  );
  return points.map((p, i) => ({ ...p, z: zs[i] ?? 0 }));
}

function resampleAlt(
  alt: Array<number | undefined | null>,
  n: number,
): Array<number | undefined> {
  if (alt.length === 0 || n <= 0) return Array.from({ length: n }, () => 0);
  if (alt.length === n) return alt.slice() as number[];
  const out: Array<number | undefined> = [];
  for (let i = 0; i < n; i += 1) {
    const t = n <= 1 ? 0 : i / (n - 1);
    const f = t * (alt.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(alt.length - 1, i0 + 1);
    const a = alt[i0];
    const b = alt[i1];
    if (typeof a === "number" && typeof b === "number") {
      out.push(a + (b - a) * (f - i0));
    } else {
      out.push(typeof a === "number" ? a : typeof b === "number" ? b : 0);
    }
  }
  return out;
}

export type TrackGradeSample = {
  /** Along-track grade (rise/run), positive = uphill ahead. */
  grade: number;
  /** Road banking (rad), positive = left side higher. */
  bank: number;
  /** Surface height at centerline (m). */
  z: number;
};

/**
 * Precompute grade + mild curvature banking for physics/mesh.
 * Flat tracks get near-zero grade/bank (DEM/flat fallback).
 */
export function buildGradeProfile(centerline: DrivePoint[]): TrackGradeSample[] {
  const n = centerline.length;
  const out: TrackGradeSample[] = new Array(n);
  if (n < 2) {
    for (let i = 0; i < n; i += 1) {
      out[i] = { grade: 0, bank: 0, z: centerline[i]?.z ?? 0 };
    }
    return out;
  }

  for (let i = 0; i < n; i += 1) {
    const prev = centerline[Math.max(0, i - 1)]!;
    const cur = centerline[i]!;
    const next = centerline[Math.min(n - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const horiz = Math.hypot(dx, dy) || 1;
    const dz = (next.z ?? 0) - (prev.z ?? 0);
    let grade = dz / horiz;
    grade = Math.max(-0.18, Math.min(0.18, grade));

    const a = centerline[Math.max(0, i - 1)]!;
    const b = cur;
    const c = centerline[Math.min(n - 1, i + 1)]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const ab = Math.hypot(abx, aby) || 1;
    const bc = Math.hypot(bcx, bcy) || 1;
    const cross = (abx / ab) * (bcy / bc) - (aby / ab) * (bcx / bc);
    let bank = Math.max(-0.12, Math.min(0.12, cross * 0.35));
    if (Math.abs(grade) < 0.002) bank *= 0.55;
    out[i] = { grade, bank, z: cur.z ?? 0 };
  }

  const sm: TrackGradeSample[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const i0 = Math.max(0, i - 1);
    const i1 = Math.min(n - 1, i + 1);
    sm[i] = {
      grade: (out[i0]!.grade + out[i]!.grade + out[i1]!.grade) / 3,
      bank: (out[i0]!.bank + out[i]!.bank + out[i1]!.bank) / 3,
      z: out[i]!.z,
    };
  }
  return sm;
}

export function sampleGrade(
  profile: TrackGradeSample[],
  segIndex: number,
): TrackGradeSample {
  if (!profile.length) return { grade: 0, bank: 0, z: 0 };
  const i = Math.max(0, Math.min(profile.length - 1, segIndex));
  return profile[i]!;
}

/** Interpolate centerline height at a ribbon hit. */
export function heightAtAlong(centerline: DrivePoint[], along: number): number {
  if (centerline.length < 2) return centerline[0]?.z ?? 0;
  let traveled = 0;
  for (let i = 0; i < centerline.length - 1; i += 1) {
    const a = centerline[i]!;
    const b = centerline[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
    if (traveled + len >= along || i === centerline.length - 2) {
      const t = Math.max(0, Math.min(1, (along - traveled) / len));
      return (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t;
    }
    traveled += len;
  }
  return centerline[centerline.length - 1]?.z ?? 0;
}
