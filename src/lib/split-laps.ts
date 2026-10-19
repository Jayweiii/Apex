import {
  buildCenterlineFromLaps,
  haversineMeters,
  type LatLon,
} from "@/lib/map-match";
import type { ParsedLap, TelemetryPoint } from "@/lib/types";

function downsample(points: TelemetryPoint[], max = 400): TelemetryPoint[] {
  if (points.length <= max) return points;
  const result: TelemetryPoint[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    result.push(points[Math.round(i * step)]);
  }
  return result;
}

function gpsPoints(points: TelemetryPoint[]): TelemetryPoint[] {
  return points.filter(
    (p) =>
      p.lat != null &&
      p.lon != null &&
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon),
  );
}

/** Local east/north meters relative to origin. */
function toLocal(origin: LatLon, point: LatLon) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const cos = Math.cos(toRad(origin.lat)) || 1;
  return {
    x: toRad(point.lon - origin.lon) * 6371000 * cos,
    y: toRad(point.lat - origin.lat) * 6371000,
  };
}

/**
 * Signed side of a start/finish gate: line through `sf` with direction
 * `gateDir` (unit vector along the gate, perpendicular to travel).
 */
function gateSide(
  sf: LatLon,
  gateDir: { x: number; y: number },
  point: LatLon,
): number {
  const p = toLocal(sf, point);
  // Travel direction ≈ perpendicular to gateDir; side = cross(gateDir, p).
  return gateDir.x * p.y - gateDir.y * p.x;
}

function unit(x: number, y: number) {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Gate direction (along the line) from approximate travel heading. */
function gateDirFromHeading(headingRad: number) {
  // Travel is (sin h, cos h) in east/north; gate is perpendicular.
  const travel = { x: Math.sin(headingRad), y: Math.cos(headingRad) };
  return unit(-travel.y, travel.x);
}

function estimateHeadingNear(
  points: TelemetryPoint[],
  sf: LatLon,
  radiusM = 80,
): number | null {
  const near: TelemetryPoint[] = [];
  for (const p of points) {
    if (p.lat == null || p.lon == null) continue;
    if (haversineMeters(sf.lat, sf.lon, p.lat, p.lon) <= radiusM) {
      near.push(p);
    }
  }
  if (near.length < 4) return null;
  // Use a mid window for stable heading through the gate.
  const a = near[Math.floor(near.length * 0.25)];
  const b = near[Math.floor(near.length * 0.75)];
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) {
    return null;
  }
  const la = toLocal(sf, { lat: a.lat, lon: a.lon });
  const lb = toLocal(sf, { lat: b.lat, lon: b.lon });
  const dx = lb.x - la.x;
  const dy = lb.y - la.y;
  if (Math.hypot(dx, dy) < 5) return null;
  return Math.atan2(dx, dy);
}

function headingFromCenterline(centerline: LatLon[], sf: LatLon): number | null {
  if (centerline.length < 2) return null;
  let bestI = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centerline.length; i += 1) {
    const d = haversineMeters(
      sf.lat,
      sf.lon,
      centerline[i].lat,
      centerline[i].lon,
    );
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const a = centerline[Math.max(0, bestI - 1)];
  const b = centerline[Math.min(centerline.length - 1, bestI + 1)];
  const la = toLocal(sf, a);
  const lb = toLocal(sf, b);
  const dx = lb.x - la.x;
  const dy = lb.y - la.y;
  if (Math.hypot(dx, dy) < 1) return null;
  return Math.atan2(dx, dy);
}

/**
 * Nearest-point progress along a closed centerline in [0, 1).
 * Lightweight (no Viterbi) — good enough for lap-boundary detection.
 */
function progressAlongCenterline(
  point: LatLon,
  centerline: LatLon[],
  cumDist: number[],
): number {
  const total = cumDist[cumDist.length - 1] || 1;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (let i = 0; i < centerline.length - 1; i += 1) {
    const a = centerline[i];
    const b = centerline[i + 1];
    const origin = a;
    const p = toLocal(origin, point);
    const pb = toLocal(origin, b);
    const len2 = pb.x * pb.x + pb.y * pb.y;
    const t =
      len2 <= 1e-12
        ? 0
        : Math.min(1, Math.max(0, (p.x * pb.x + p.y * pb.y) / len2));
    const sx = pb.x * t;
    const sy = pb.y * t;
    const d = Math.hypot(p.x - sx, p.y - sy);
    if (d < bestDist) {
      bestDist = d;
      bestAlong = cumDist[i] + Math.sqrt(len2) * t;
    }
  }
  return bestAlong / total;
}

function cumulativePath(points: LatLon[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i += 1) {
    out.push(
      out[i - 1] +
        haversineMeters(
          points[i - 1].lat,
          points[i - 1].lon,
          points[i].lat,
          points[i].lon,
        ),
    );
  }
  return out;
}

/**
 * Estimate a one-lap centerline from a continuous session by taking the first
 * return-to-start loop (handles missing track geometry).
 */
export function estimateCenterlineFromSession(
  points: TelemetryPoint[],
  options?: { minLapMeters?: number; closeMeters?: number },
): LatLon[] | null {
  const gps = gpsPoints(points);
  if (gps.length < 40) return null;
  const moving =
    gps.find((p) => (p.speed ?? 0) > 40) ??
    gps.find((p) => (p.speed ?? 0) > 20) ??
    gps[0];
  if (moving.lat == null || moving.lon == null) return null;
  const minLapMeters = options?.minLapMeters ?? 400;
  const closeMeters = options?.closeMeters ?? 45;
  let traveled = 0;
  let prev = moving;
  const startIdx = gps.indexOf(moving);
  for (let i = startIdx + 1; i < gps.length; i += 1) {
    const point = gps[i];
    if (
      prev.lat == null ||
      prev.lon == null ||
      point.lat == null ||
      point.lon == null
    ) {
      continue;
    }
    traveled += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    prev = point;
    if (traveled < minLapMeters) continue;
    const dist = haversineMeters(
      moving.lat,
      moving.lon,
      point.lat,
      point.lon,
    );
    if (dist <= closeMeters) {
      const loop = gps.slice(startIdx, i + 1).map((p, idx) => ({
        t: p.t ?? idx,
        speed: p.speed ?? 80,
        lat: p.lat!,
        lon: p.lon!,
      }));
      return buildCenterlineFromLaps([loop]) ?? null;
    }
  }
  return null;
}

function crossingsFromSfGate(
  points: TelemetryPoint[],
  sf: LatLon,
  headingRad: number,
  options: { minLapMeters: number; gateHalfWidthM: number },
): number[] {
  const gateDir = gateDirFromHeading(headingRad);
  const travel = {
    x: Math.sin(headingRad),
    y: Math.cos(headingRad),
  };
  const crossings: number[] = [];
  let traveled = 0;
  let lastCrossTraveled = -options.minLapMeters;
  let prev = points[0];
  let prevSide: number | null = null;

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (
      prev.lat != null &&
      prev.lon != null &&
      point.lat != null &&
      point.lon != null
    ) {
      traveled += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
    if (point.lat == null || point.lon == null) {
      prev = point;
      continue;
    }
    const distSf = haversineMeters(sf.lat, sf.lon, point.lat, point.lon);
    const side = gateSide(sf, gateDir, { lat: point.lat, lon: point.lon });
    if (
      prevSide != null &&
      distSf <= options.gateHalfWidthM &&
      Math.sign(side) !== 0 &&
      Math.sign(prevSide) !== 0 &&
      Math.sign(side) !== Math.sign(prevSide) &&
      traveled - lastCrossTraveled >= options.minLapMeters * 0.55
    ) {
      // Require forward crossing (travel · motion > 0).
      if (
        prev.lat != null &&
        prev.lon != null &&
        point.lat != null &&
        point.lon != null
      ) {
        const a = toLocal(sf, { lat: prev.lat, lon: prev.lon });
        const b = toLocal(sf, { lat: point.lat, lon: point.lon });
        const mx = b.x - a.x;
        const my = b.y - a.y;
        const forward = mx * travel.x + my * travel.y;
        if (forward > 0) {
          crossings.push(i);
          lastCrossTraveled = traveled;
        }
      }
    }
    prevSide = side;
    prev = point;
  }
  return crossings;
}

function crossingsFromProgressWrap(
  points: TelemetryPoint[],
  centerline: LatLon[],
  options: { minLapMeters: number },
): number[] {
  const cum = cumulativePath(centerline);
  const total = cum[cum.length - 1] || 1;
  if (total < options.minLapMeters * 0.5) return [];
  const progress: number[] = [];
  for (const p of points) {
    if (p.lat == null || p.lon == null) {
      progress.push(Number.NaN);
      continue;
    }
    progress.push(
      progressAlongCenterline({ lat: p.lat, lon: p.lon }, centerline, cum),
    );
  }
  const crossings: number[] = [];
  let traveled = 0;
  let lastCrossTraveled = -options.minLapMeters;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (
      a.lat != null &&
      a.lon != null &&
      b.lat != null &&
      b.lon != null
    ) {
      traveled += haversineMeters(a.lat, a.lon, b.lat, b.lon);
    }
    const pa = progress[i - 1];
    const pb = progress[i];
    if (!Number.isFinite(pa) || !Number.isFinite(pb)) continue;
    // Wrap: was near end, now near start.
    if (
      pa > 0.72 &&
      pb < 0.28 &&
      traveled - lastCrossTraveled >= options.minLapMeters * 0.55
    ) {
      crossings.push(i);
      lastCrossTraveled = traveled;
    }
  }
  return crossings;
}

function crossingsFromLoopClosure(
  points: TelemetryPoint[],
  start: LatLon,
  options: { minLapMeters: number; closeMeters: number },
): number[] {
  const crossings: number[] = [];
  let traveled = 0;
  let lastCrossTraveled = -options.minLapMeters;
  let prev = points[0];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (
      prev.lat != null &&
      prev.lon != null &&
      point.lat != null &&
      point.lon != null
    ) {
      traveled += haversineMeters(prev.lat, prev.lon, point.lat, point.lon);
    }
    if (
      point.lat != null &&
      point.lon != null &&
      traveled - lastCrossTraveled >= options.minLapMeters &&
      haversineMeters(start.lat, start.lon, point.lat, point.lon) <=
        options.closeMeters
    ) {
      crossings.push(i);
      lastCrossTraveled = traveled;
    }
    prev = point;
  }
  return crossings;
}

/**
 * Prefer the crossing set whose resulting segments look like repeated hot
 * laps (similar duration, enough distance) — avoids both under- and over-split.
 */
function pickBestCrossings(
  points: TelemetryPoint[],
  candidates: number[][],
  minLapMeters: number,
): number[] {
  let best: number[] = [];
  let bestScore = -1;
  for (const crossings of candidates) {
    if (!crossings.length) continue;
    const segments = segmentsFromCrossings(points, crossings);
    if (segments.length < 2) continue;
    const durations = segments
      .map((seg) => {
        if (seg.length < 2) return 0;
        return seg[seg.length - 1].t - seg[0].t;
      })
      .filter((d) => d >= 25);
    if (durations.length < 1) continue;
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 1;
    const similar = durations.filter(
      (d) => Math.abs(d - median) / median < 0.35,
    ).length;
    const longEnough = segments.filter(
      (seg) => pathLength(seg) >= minLapMeters * 0.55,
    ).length;
    const score = similar * 10 + longEnough * 3 + Math.min(crossings.length, 20);
    // Penalize absurd over-splits (median hot lap < 40s on a road course).
    const penalty = median < 40 ? 40 : 0;
    const finalScore = score - penalty;
    if (finalScore > bestScore) {
      bestScore = finalScore;
      best = crossings;
    }
  }
  return best;
}

function segmentsFromCrossings(
  points: TelemetryPoint[],
  crossings: number[],
): TelemetryPoint[][] {
  if (!crossings.length) {
    return points.length >= 20 ? [points] : [];
  }
  const bounds = [0, ...crossings, points.length - 1];
  const segments: TelemetryPoint[][] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end - start < 8) continue;
    segments.push(points.slice(start, end + 1));
  }
  return segments;
}

function pathLength(points: TelemetryPoint[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (
      a.lat != null &&
      a.lon != null &&
      b.lat != null &&
      b.lon != null
    ) {
      sum += haversineMeters(a.lat, a.lon, b.lat, b.lon);
    }
  }
  return sum;
}

/**
 * Split a continuous GPS trace into laps.
 *
 * Prefers start/finish gate crossings (with optional centerline snap for
 * heading / progress wraps). Falls back to repeated loop closure when no SF
 * is known. Tuned for GoPro ~10–18 Hz GPS with outlap/inlap tails.
 */
export function splitLapsByStartFinish(
  points: TelemetryPoint[],
  options?: {
    minLapMeters?: number;
    closeMeters?: number;
    sessionStartedAtMs?: number;
    /** Official track start/finish (preferred over first GPS sample). */
    startFinish?: { lat: number; lon: number } | null;
    /** Track centerline — enables progress-wrap + better SF heading. */
    centerline?: LatLon[] | null;
  },
): ParsedLap[] {
  const gps = gpsPoints(points);
  if (gps.length < 20) {
    throw new Error("Not enough GPS samples to build laps");
  }

  const moving = gps.filter((p) => (p.speed ?? 0) > 15);
  if (moving.length < 20) {
    throw new Error(
      "No GPS motion found — file may be pit/idle only, or location was not locked.",
    );
  }

  const sessionStartT = points[0]?.t ?? gps[0].t;
  const minLapMeters = options?.minLapMeters ?? 400;
  // Wider gate for ~10–18 Hz (~3 m/sample at 100 km/h) and GPS noise.
  const closeMeters = options?.closeMeters ?? 55;
  const gateHalfWidthM = Math.max(closeMeters, 60);

  let centerline =
    options?.centerline && options.centerline.length >= 8
      ? options.centerline
      : null;

  const sfOpt = options?.startFinish;
  let sf: LatLon | null =
    sfOpt && Number.isFinite(sfOpt.lat) && Number.isFinite(sfOpt.lon)
      ? { lat: sfOpt.lat, lon: sfOpt.lon }
      : null;

  // Build a one-lap reference from the session when track geometry is missing
  // or the catalog SF sits far off the racing line (common for West presets).
  if (!centerline) {
    centerline = estimateCenterlineFromSession(gps, {
      minLapMeters,
      closeMeters,
    });
  }
  if (sf && centerline && centerline.length >= 8) {
    let best = centerline[0];
    let bestD = haversineMeters(sf.lat, sf.lon, best.lat, best.lon);
    for (const p of centerline) {
      const d = haversineMeters(sf.lat, sf.lon, p.lat, p.lon);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    // Snap catalog SF onto the driven line when it's clearly off-track.
    if (bestD > 40) {
      sf = { lat: best.lat, lon: best.lon };
    }
  } else if (!sf && centerline && centerline.length) {
    sf = { lat: centerline[0].lat, lon: centerline[0].lon };
  }

  // Score candidate crossing sets — pick the one with the most plausible
  // hot-lap count (similar durations), not the first that fires.
  const candidates: number[][] = [];

  if (sf) {
    const heading =
      (centerline ? headingFromCenterline(centerline, sf) : null) ??
      estimateHeadingNear(gps, sf) ??
      0;
    candidates.push(
      crossingsFromSfGate(gps, sf, heading, {
        minLapMeters,
        gateHalfWidthM,
      }),
    );
  }

  {
    const start =
      sf ??
      ({
        lat: moving[0].lat!,
        lon: moving[0].lon!,
      } as LatLon);
    candidates.push(
      crossingsFromLoopClosure(gps, start, {
        minLapMeters,
        closeMeters,
      }),
    );
  }

  if (centerline && centerline.length >= 8) {
    const loopM = cumulativePath(centerline).at(-1) ?? 0;
    if (loopM >= 800 && loopM <= 12_000) {
      candidates.push(
        crossingsFromProgressWrap(gps, centerline, { minLapMeters }),
      );
    }
  }

  let crossings = pickBestCrossings(gps, candidates, minLapMeters);

  const segments = segmentsFromCrossings(gps, crossings);
  const laps: ParsedLap[] = [];

  segments.forEach((segment, index) => {
    if (segment.length < 2) return;
    const meters = pathLength(segment);
    // Drop tiny pit wiggles; keep outlap/inlap that cover meaningful distance.
    if (meters < minLapMeters * 0.35 && index > 0 && index < segments.length - 1) {
      return;
    }
    const t0 = segment[0].t;
    const startOffsetSec = Number((t0 - sessionStartT).toFixed(3));
    const normalized = segment.map((point) => ({
      ...point,
      t: Number((point.t - t0).toFixed(3)),
    }));
    const lapTimeMs = Math.max(
      0,
      Math.round(
        (normalized[normalized.length - 1].t - normalized[0].t) * 1000,
      ),
    );
    if (lapTimeMs < 1000) return;
    const startedAtMs =
      options?.sessionStartedAtMs != null
        ? Math.round(options.sessionStartedAtMs + startOffsetSec * 1000)
        : undefined;
    laps.push({
      lapNumber: index + 1,
      lapTimeMs,
      points: downsample(normalized),
      startOffsetSec,
      startedAtMs,
    });
  });

  if (!laps.length) {
    const t0 = moving[0].t;
    const startOffsetSec = Number((t0 - sessionStartT).toFixed(3));
    const normalized = moving.map((point) => ({
      ...point,
      t: Number((point.t - t0).toFixed(3)),
    }));
    laps.push({
      lapNumber: 1,
      lapTimeMs: Math.max(
        1000,
        Math.round(
          (normalized[normalized.length - 1].t - normalized[0].t) * 1000,
        ),
      ),
      points: downsample(normalized),
      startOffsetSec,
      startedAtMs:
        options?.sessionStartedAtMs != null
          ? Math.round(options.sessionStartedAtMs + startOffsetSec * 1000)
          : undefined,
    });
  }

  return laps;
}
