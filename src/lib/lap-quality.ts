import { haversineMeters } from "@/lib/map-match";
import type { TelemetryPoint } from "@/lib/types";

/** Lap fields needed for best-lap eligibility and auto-flagging. */
export type LapQualityInput = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  telemetry?: TelemetryPoint[] | null;
  excluded?: boolean | null;
  exclude_reason?: string | null;
};

export type SuspiciousReason =
  | "duration_outlier"
  | "partial_coverage"
  | "out_lap"
  | "in_lap"
  | "gps_jump";

export type LapSuspicion = {
  lapId: string;
  reasons: SuspiciousReason[];
  /** Short labels for badges / one-click exclude reason. */
  labels: string[];
};

const DURATION_REL_THRESHOLD = 0.15;
const DURATION_ABS_MS = 8_000;
/** Start/finish gap above this ⇒ incomplete lap (meters). */
const SF_GAP_PARTIAL_M = 120;
/** Path length below this fraction of session median ⇒ partial. */
const PATH_LEN_FRAC = 0.7;
/** Single hop above this is a GPS jump (meters). */
const GPS_JUMP_M = 80;
/** Implied speed above this between samples is a jump (m/s ≈ 288 km/h). */
const GPS_JUMP_SPEED_MS = 80;

export function isLapExcluded(
  lap: { excluded?: boolean | null } | null | undefined,
): boolean {
  return Boolean(lap?.excluded);
}

/** Absolute floor — out/in segments are typically well under this. */
export const MIN_FULL_LAP_MS = 45_000;
/** Reject laps shorter/longer than this fraction of the session median. */
const MEDIAN_LO = 0.55;
const MEDIAN_HI = 1.45;

/**
 * Duration-only plausibility for full flying laps (no telemetry required).
 * Used by cloud leaderboards where GPS samples are not loaded.
 */
export function isPlausibleFullLapMs(
  lapTimeMs: number,
  sessionMedianMs?: number | null,
): boolean {
  if (!Number.isFinite(lapTimeMs) || lapTimeMs < MIN_FULL_LAP_MS) return false;
  if (sessionMedianMs != null && sessionMedianMs > 0) {
    if (lapTimeMs < sessionMedianMs * MEDIAN_LO) return false;
    if (lapTimeMs > sessionMedianMs * MEDIAN_HI) return false;
  }
  return true;
}

function sessionMedianLapMs(
  laps: Array<{ lap_time_ms: number; excluded?: boolean | null }>,
): number | null {
  const times = laps
    .filter((lap) => !isLapExcluded(lap) && lap.lap_time_ms >= MIN_FULL_LAP_MS)
    .map((lap) => lap.lap_time_ms);
  return median(times);
}

/** Laps that count toward best / theo / sectors / leaderboards. */
export function lapsEligibleForBest<
  T extends {
    id?: string;
    lap_number?: number;
    lap_time_ms: number;
    excluded?: boolean | null;
    telemetry?: TelemetryPoint[] | null;
  },
>(laps: T[]): T[] {
  const included = laps.filter((lap) => !isLapExcluded(lap));
  if (!included.length) return [];

  const med = sessionMedianLapMs(included);
  const suspicious = suspicionByLapId(
    included.map((lap, index) => ({
      id: lap.id ?? `lap-${index}`,
      lap_number: lap.lap_number ?? index + 1,
      lap_time_ms: lap.lap_time_ms,
      telemetry: lap.telemetry,
      excluded: lap.excluded,
    })),
  );

  return included.filter((lap, index) => {
    if (!isPlausibleFullLapMs(lap.lap_time_ms, med)) return false;
    const id = lap.id ?? `lap-${index}`;
    const flag = suspicious.get(id);
    if (!flag) return true;
    // Out/in/GPS-jump/partial never count as session best.
    return !flag.reasons.some(
      (reason) =>
        reason === "out_lap" ||
        reason === "in_lap" ||
        reason === "gps_jump" ||
        reason === "partial_coverage" ||
        reason === "duration_outlier",
    );
  });
}

export function bestLapTimeMs(
  laps: Array<{
    id?: string;
    lap_number?: number;
    lap_time_ms: number;
    excluded?: boolean | null;
    telemetry?: TelemetryPoint[] | null;
  }>,
): number | null {
  const eligible = lapsEligibleForBest(laps);
  if (!eligible.length) return null;
  return Math.min(...eligible.map((lap) => lap.lap_time_ms));
}

/**
 * Prefer non-excluded / valid full laps for default compare refs.
 * Falls back to all laps only when every lap is filtered out (still viewable).
 */
export function lapsForDefaultCompare<
  T extends {
    id?: string;
    lap_number?: number;
    lap_time_ms: number;
    excluded?: boolean | null;
    telemetry?: TelemetryPoint[] | null;
  },
>(laps: T[]): T[] {
  const eligible = lapsEligibleForBest(laps);
  return eligible.length ? eligible : laps;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function pathLengthMeters(points: TelemetryPoint[]): number {
  let sum = 0;
  let prev: TelemetryPoint | null = null;
  for (const point of points) {
    if (point.lat == null || point.lon == null) continue;
    if (
      prev?.lat != null &&
      prev.lon != null &&
      Number.isFinite(prev.lat) &&
      Number.isFinite(prev.lon)
    ) {
      sum += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
    prev = point;
  }
  return sum;
}

function startFinishGapMeters(points: TelemetryPoint[]): number | null {
  let first: TelemetryPoint | null = null;
  let last: TelemetryPoint | null = null;
  for (const point of points) {
    if (point.lat == null || point.lon == null) continue;
    if (!first) first = point;
    last = point;
  }
  if (!first || !last || first === last) return null;
  if (first.lat == null || first.lon == null || last.lat == null || last.lon == null) {
    return null;
  }
  return haversineMeters(first.lat, first.lon, last.lat, last.lon);
}

function hasBigGpsJump(points: TelemetryPoint[]): boolean {
  let prev: TelemetryPoint | null = null;
  for (const point of points) {
    if (point.lat == null || point.lon == null) continue;
    if (
      prev?.lat != null &&
      prev.lon != null &&
      Number.isFinite(prev.lat) &&
      Number.isFinite(prev.lon)
    ) {
      const dist = haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
      if (dist >= GPS_JUMP_M) return true;
      const dt = Math.max(0.001, (point.t ?? 0) - (prev.t ?? 0));
      if (dist / dt >= GPS_JUMP_SPEED_MS) return true;
    }
    prev = point;
  }
  return false;
}

const REASON_LABELS: Record<SuspiciousReason, string> = {
  duration_outlier: "Odd duration",
  partial_coverage: "Partial lap",
  out_lap: "Out lap",
  in_lap: "In lap",
  gps_jump: "GPS jump",
};

/**
 * Auto-flag suspicious laps (splitter bugs, outlaps, GPS glitches).
 * Does NOT exclude — UI shows a label only; Jason wants no auto-exclude.
 * First/last partial segments are labeled out lap / in lap.
 */
export function flagSuspiciousLaps(laps: LapQualityInput[]): LapSuspicion[] {
  if (laps.length < 2) return [];

  const times = laps.map((lap) => lap.lap_time_ms).filter((t) => t > 0);
  const medTime = median(times);
  const pathLens = laps.map((lap) => pathLengthMeters(lap.telemetry ?? []));
  const positivePaths = pathLens.filter((len) => len > 50);
  const medPath = median(positivePaths);
  const lastIdx = laps.length - 1;

  const out: LapSuspicion[] = [];
  for (let i = 0; i < laps.length; i += 1) {
    const lap = laps[i]!;
    const reasons: SuspiciousReason[] = [];
    const points = lap.telemetry ?? [];

    let durationOutlier = false;
    if (medTime != null && medTime > 0) {
      const delta = Math.abs(lap.lap_time_ms - medTime);
      const rel = delta / medTime;
      if (rel >= DURATION_REL_THRESHOLD || delta >= DURATION_ABS_MS) {
        durationOutlier = true;
      }
    }

    const gap = startFinishGapMeters(points);
    const pathLen = pathLens[i] ?? 0;
    const partialByGap = gap != null && gap > SF_GAP_PARTIAL_M;
    const partialByPath =
      medPath != null && medPath > 100 && pathLen > 0 && pathLen < medPath * PATH_LEN_FRAC;
    const looksPartial = partialByGap || partialByPath || durationOutlier;

    // Out/in: label first/last incomplete segments — never auto-exclude.
    if (looksPartial && i === 0) {
      reasons.push("out_lap");
    } else if (looksPartial && i === lastIdx) {
      reasons.push("in_lap");
    } else {
      if (durationOutlier) reasons.push("duration_outlier");
      if (partialByGap || partialByPath) reasons.push("partial_coverage");
    }

    if (hasBigGpsJump(points)) {
      reasons.push("gps_jump");
    }

    if (reasons.length) {
      out.push({
        lapId: lap.id,
        reasons,
        labels: reasons.map((r) => REASON_LABELS[r]),
      });
    }
  }
  return out;
}

export function suspicionByLapId(
  laps: LapQualityInput[],
): Map<string, LapSuspicion> {
  const map = new Map<string, LapSuspicion>();
  for (const item of flagSuspiciousLaps(laps)) {
    map.set(item.lapId, item);
  }
  return map;
}

export function formatExcludeReason(labels: string[]): string {
  return labels.join("; ").slice(0, 200);
}
