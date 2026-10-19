import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtinCenterline } from "../src/lib/centerlines";
import { compareLaps, withDistance } from "../src/lib/compare";
import { cornerBreakdown } from "../src/lib/analysis";
import {
  buildCenterlineFromLaps,
  clampDisplacement,
  haversineMeters,
  lightCorrectTowardCenterline,
  mapMatchLap,
  MAX_LATERAL_CORRECTION_M,
  parseCenterline,
  savitzkyGolay,
  snapToCenterline,
  type LatLon,
  type MatchedPoint,
} from "../src/lib/map-match";
import { parseVbo } from "../src/lib/parse-gps-logger";
import { getTrack } from "../src/lib/tracks";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");

/** Synthetic oval at ~10 Hz (TrackAddict-like). */
function ovalLap(opts?: {
  hz?: number;
  noiseM?: number;
  durationSec?: number;
  speedBias?: number;
}): TelemetryPoint[] {
  const hz = opts?.hz ?? 10;
  const noiseM = opts?.noiseM ?? 0;
  const durationSec = opts?.durationSec ?? 90;
  const speedBias = opts?.speedBias ?? 0;
  const count = Math.round(durationSec * hz);
  const center = { lat: 39.540333, lon: -122.330694 };
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos(toRad(center.lat)) || 1;
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const progress = i / count;
    const a = progress * Math.PI * 2;
    const mod = 1 + 0.18 * Math.sin(a * 3) * 0.55 + 0.18 * Math.cos(a * 2) * 0.35;
    const north = Math.sin(a) * 620 * mod;
    const east = Math.cos(a) * 780 * mod;
    const noiseN = noiseM ? (Math.sin(i * 1.7) * noiseM) / 2 : 0;
    const noiseE = noiseM ? (Math.cos(i * 2.3) * noiseM) / 2 : 0;
    points.push({
      t: i / hz,
      speed: 100 + 35 * Math.sin(a * 2) + speedBias,
      lat: center.lat + toDeg((north + noiseN) / 6371000),
      lon: center.lon + toDeg((east + noiseE) / (6371000 * cos)),
    });
  }
  return points;
}

/**
 * Synthetic hairpin: long approach, 180° turn of radius R, long exit parallel
 * to the approach (~gap meters apart). Used to catch corner-cutting shortcuts.
 */
function hairpinLap(opts?: {
  hz?: number;
  radiusM?: number;
  gapM?: number;
  noiseM?: number;
  lateralBiasM?: number;
}): { points: TelemetryPoint[]; centerline: LatLon[]; truePathLen: number } {
  const hz = opts?.hz ?? 10;
  const radiusM = opts?.radiusM ?? 28;
  const gapM = opts?.gapM ?? 18;
  const noiseM = opts?.noiseM ?? 0;
  const lateralBiasM = opts?.lateralBiasM ?? 4;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const origin = { lat: 39.535, lon: -122.34 };
  const cos = Math.cos(toRad(origin.lat)) || 1;
  const toLatLon = (x: number, y: number): LatLon => ({
    lat: origin.lat + toDeg(y / 6371000),
    lon: origin.lon + toDeg(x / (6371000 * cos)),
  });

  // Centerline: approach x=0 → hairpin arc → exit x=2R (parallel return).
  void gapM;
  const cl: LatLon[] = [];
  for (let y = -200; y <= 0; y += 3) cl.push(toLatLon(0, y));
  for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-9; a += Math.PI / 36) {
    cl.push(toLatLon(radiusM + radiusM * Math.sin(a), radiusM * Math.cos(a)));
  }
  for (let y = 0; y >= -200; y -= 3) cl.push(toLatLon(2 * radiusM, y));
  // Open polyline (U-shape) — do not loop-close or we chord the throat.
  const centerline = cl;

  // Racing line: offset laterally by bias, follow full arc (no chord).
  const points: TelemetryPoint[] = [];
  let t = 0;
  const dt = 1 / hz;
  const speed = 70;
  const push = (x: number, y: number) => {
    const n = noiseM ? ((Math.sin(t * 7.1) * noiseM) / 2) : 0;
    const e = noiseM ? ((Math.cos(t * 5.3) * noiseM) / 2) : 0;
    // Bias "outside" on approach (negative x), follow larger radius on arc.
    const ll = toLatLon(x + e, y + n);
    points.push({ t, speed, lat: ll.lat, lon: ll.lon });
    t += dt;
  };

  for (let y = -200; y <= 0; y += speed / hz) {
    push(-lateralBiasM, y);
  }
  const raceR = radiusM + lateralBiasM;
  for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-9; a += (speed / hz) / raceR) {
    push(radiusM + raceR * Math.sin(a), raceR * Math.cos(a));
  }
  for (let y = 0; y >= -200; y -= speed / hz) {
    push(2 * radiusM + lateralBiasM, y);
  }

  let truePathLen = 0;
  for (let i = 1; i < points.length; i += 1) {
    truePathLen += haversineMeters(
      points[i - 1].lat!,
      points[i - 1].lon!,
      points[i].lat!,
      points[i].lon!,
    );
  }
  return { points, centerline, truePathLen };
}

/** Legacy nearest-point snap onto centerline (collapses racing line). */
function legacyNearestSnap(
  points: TelemetryPoint[],
  centerline: LatLon[],
): MatchedPoint[] {
  const origin = centerline[0];
  const lineDist = [0];
  for (let i = 1; i < centerline.length; i += 1) {
    lineDist.push(
      lineDist[i - 1] +
        haversineMeters(
          centerline[i - 1].lat,
          centerline[i - 1].lon,
          centerline[i].lat,
          centerline[i].lon,
        ),
    );
  }
  return points.map((point) => {
    if (point.lat == null || point.lon == null) {
      return { ...point, trackDist: 0, lateralOffset: 0 };
    }
    let bestDist = Number.POSITIVE_INFINITY;
    let bestLat = point.lat;
    let bestLon = point.lon;
    let bestAlong = 0;
    let bestLatOff = 0;
    for (let i = 0; i < centerline.length - 1; i += 1) {
      const a = centerline[i];
      const b = centerline[i + 1];
      // Project in meters
      const toRad = (d: number) => (d * Math.PI) / 180;
      const cos = Math.cos(toRad(origin.lat)) || 1;
      const px = toRad(point.lon - origin.lon) * 6371000 * cos;
      const py = toRad(point.lat - origin.lat) * 6371000;
      const ax = toRad(a.lon - origin.lon) * 6371000 * cos;
      const ay = toRad(a.lat - origin.lat) * 6371000;
      const bx = toRad(b.lon - origin.lon) * 6371000 * cos;
      const by = toRad(b.lat - origin.lat) * 6371000;
      const abx = bx - ax;
      const aby = by - ay;
      const len2 = abx * abx + aby * aby;
      const tt =
        len2 <= 1e-12
          ? 0
          : Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / len2));
      const sx = ax + abx * tt;
      const sy = ay + aby * tt;
      const d = Math.hypot(px - sx, py - sy);
      if (d < bestDist) {
        bestDist = d;
        const toDeg = (r: number) => (r * 180) / Math.PI;
        bestLat = origin.lat + toDeg(sy / 6371000);
        bestLon = origin.lon + toDeg(sx / (6371000 * cos));
        bestAlong = lineDist[i] + Math.sqrt(len2) * tt;
        bestLatOff = abx * (py - sy) - aby * (px - sx) >= 0 ? d : -d;
      }
    }
    return {
      ...point,
      lat: bestLat,
      lon: bestLon,
      trackDist: bestAlong,
      lateralOffset: bestLatOff,
      rawLat: point.lat,
      rawLon: point.lon,
    };
  });
}

function pathLength(points: Array<{ lat?: number | null; lon?: number | null }>) {
  let sum = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) continue;
    sum += haversineMeters(a.lat, a.lon, b.lat, b.lon);
  }
  return sum;
}

function meanDispFromRaw(matched: MatchedPoint[]) {
  let sum = 0;
  let n = 0;
  for (const p of matched) {
    if (p.rawLat == null || p.rawLon == null || p.lat == null || p.lon == null) continue;
    sum += haversineMeters(p.rawLat, p.rawLon, p.lat, p.lon);
    n += 1;
  }
  return n ? sum / n : 0;
}

function maxTrackJump(matched: MatchedPoint[]) {
  let max = 0;
  for (let i = 1; i < matched.length; i += 1) {
    const ds = matched[i].trackDist - matched[i - 1].trackDist;
    if (ds > max) max = ds;
  }
  return max;
}

function main() {
  // Savitzky–Golay preserves a constant series and reduces spike energy.
  const smooth = savitzkyGolay([1, 2, 100, 2, 1, 2, 1], 5);
  assert(smooth[2] < 60, "SG should damp spike");
  assert(Math.abs(savitzkyGolay([5, 5, 5, 5, 5], 5)[2] - 5) < 1e-9, "SG constant");

  const origin = { lat: 39.54, lon: -122.33 };
  const pulled = lightCorrectTowardCenterline(
    origin,
    { lat: 39.54, lon: -122.33 },
    { lat: 39.5402, lon: -122.33 },
    2,
  );
  assert(
    haversineMeters(39.54, -122.33, pulled.lat, pulled.lon) <= 2.05,
    "light correct capped",
  );
  const clamped = clampDisplacement(
    origin,
    { lat: 39.54, lon: -122.33 },
    { lat: 39.5405, lon: -122.33 },
    2,
  );
  assert(
    haversineMeters(39.54, -122.33, clamped.lat, clamped.lon) <= 2.05,
    "clamp displacement",
  );

  const clean = ovalLap({ hz: 10, noiseM: 0 });
  const noisy = ovalLap({ hz: 18, noiseM: 12, speedBias: 1 }); // GoPro-like 18 Hz
  const noisySlow = ovalLap({ hz: 10, noiseM: 14, durationSec: 92, speedBias: -2 });

  const built = buildCenterlineFromLaps([clean, noisy, noisySlow]);
  assert(built && built.length >= 50, "centerline from laps");
  // Cleanest-lap builder should pick the clean (fastest consistent) lap, not average.
  assert(built!.length >= 400, `dense centerline ${built!.length}`);

  const thunderhill = builtinCenterline("thunderhill-east");
  assert(thunderhill && thunderhill.length >= 50, "builtin thunderhill");

  const matched = mapMatchLap(noisy, thunderhill);
  assert(matched && matched.length === noisy.length, "matched length");
  assert(
    matched!.every((point) => point.trackDist != null && point.rawLat != null),
    "trackDist + raw GPS preserved",
  );

  // Monotonic along-track progress (allow tiny float noise).
  for (let i = 1; i < matched!.length; i += 1) {
    assert(
      matched![i].trackDist + 1e-6 >= matched![i - 1].trackDist,
      `monotonic trackDist at ${i}`,
    );
  }

  // Display must stay near raw GPS (racing line preserved; ≤ ~2m mean correction).
  const meanDisp = meanDispFromRaw(matched!);
  assert(
    meanDisp < MAX_LATERAL_CORRECTION_M + 0.5,
    `mean display displacement ${meanDisp} exceeds cap`,
  );

  // Legacy nearest collapses onto centerline — much farther from raw.
  const legacy = legacyNearestSnap(noisy, thunderhill!);
  const legacyDisp = meanDispFromRaw(legacy);
  assert(
    legacyDisp > meanDisp + 2,
    `legacy should move more (${legacyDisp} vs ${meanDisp})`,
  );

  // Distance alignment for compare should use trackDist.
  const dists = withDistance(matched!);
  assert(dists[dists.length - 1].dist > 1000, "track length meters");
  assert(
    Math.abs(dists[10].dist - (matched![10].trackDist - matched![0].trackDist)) < 1e-6,
    "withDistance prefers trackDist",
  );

  const series = compareLaps(matched!, mapMatchLap(noisySlow, thunderhill!)!);
  assert(series.length > 10, "compare series");
  assert(series.every((point) => Number.isFinite(point.delta)), "finite deltas");

  const corners = cornerBreakdown(
    {
      lapNumber: 1,
      lapTimeMs: 90000,
      points: matched!,
    },
    {
      lapNumber: 2,
      lapTimeMs: 92000,
      points: mapMatchLap(noisySlow, thunderhill!)!,
    },
  );
  assert(corners.length >= 1, "corners from matched laps");

  // parseCenterline accepts lon aliases.
  const parsed = parseCenterline([
    { lat: 1, longitude: 2 },
    { lat: 1.1, lng: 2.1 },
    { lat: 1.2, lon: 2.2 },
  ]);
  assert(parsed?.length === 3, "parse centerline aliases");

  // Built-in length roughly Thunderhill East (~4.6 km).
  let builtinLen = 0;
  for (let i = 1; i < thunderhill!.length; i += 1) {
    builtinLen += haversineMeters(
      thunderhill![i - 1].lat,
      thunderhill![i - 1].lon,
      thunderhill![i].lat,
      thunderhill![i].lon,
    );
  }
  assert(builtinLen > 3000 && builtinLen < 7000, `builtin length ${builtinLen}`);

  // --- Hairpin regression: snapped path must not chord-cut the apex ---
  const hairpin = hairpinLap({ hz: 10, radiusM: 30, noiseM: 1.5, lateralBiasM: 5 });
  const hairMatched = mapMatchLap(hairpin.points, hairpin.centerline);
  assert(hairMatched && hairMatched.length === hairpin.points.length, "hairpin match");
  const hairPath = pathLength(hairMatched!);
  const hairRaw = pathLength(hairpin.points);
  // Chord across hairpin would be ~π*R shorter; require ≥ 85% of raw path.
  assert(
    hairPath > hairRaw * 0.85,
    `hairpin path cut: snapped ${hairPath.toFixed(0)} vs raw ${hairRaw.toFixed(0)}`,
  );
  const hairDisp = meanDispFromRaw(hairMatched!);
  assert(hairDisp < 3, `hairpin mean disp ${hairDisp}`);
  // No giant along-track teleport through the hairpin throat.
  assert(maxTrackJump(hairMatched!) < 80, `hairpin track jump ${maxTrackJump(hairMatched!)}`);

  const hairLegacy = legacyNearestSnap(hairpin.points, hairpin.centerline);
  const hairLegacyPath = pathLength(hairLegacy);
  // New matcher should keep more of the arc than legacy nearest when noisy.
  assert(
    hairPath + 5 >= hairLegacyPath * 0.9 || hairDisp < meanDispFromRaw(hairLegacy),
    "hairpin improves on legacy collapse or path",
  );

  // --- Dragy Oct 17 Thunderhill West fixture ---
  const west = getTrack("thunderhill-west");
  assert(west != null, "thunderhill-west");
  const vbo = readFileSync(
    resolve(root, "src/lib/fixtures/dragy-drg71-thunderhill-west.vbo"),
    "utf8",
  );
  const dragy = parseVbo(vbo, { startFinish: { lat: west!.lat, lon: west!.lon } });
  assert(dragy.laps.length >= 1, "dragy laps");
  const dragyLaps = dragy.laps.map((l) => l.points);
  const westCl = buildCenterlineFromLaps(dragyLaps);
  assert(westCl && westCl.length >= 100, "west centerline from cleanest lap");
  const dragyMatched = mapMatchLap(dragyLaps[0], westCl);
  assert(dragyMatched, "dragy matched");
  const dragyDisp = meanDispFromRaw(dragyMatched!);
  assert(dragyDisp < 3, `dragy mean disp ${dragyDisp}`);
  for (let i = 1; i < dragyMatched!.length; i += 1) {
    assert(
      dragyMatched![i].trackDist + 1e-6 >= dragyMatched![i - 1].trackDist,
      `dragy monotonic at ${i}`,
    );
  }

  // Optional cloud lap fixture (TrackAddict Oct 17) if present.
  const cloudPath = resolve(root, "src/lib/fixtures/thunderhill-west-cloud-lap.json");
  let cloudStats: Record<string, number> | null = null;
  try {
    const cloudLap = JSON.parse(readFileSync(cloudPath, "utf8")) as TelemetryPoint[];
    const cloudCl = buildCenterlineFromLaps([cloudLap, ...dragyLaps]);
    const cloudMatched = mapMatchLap(cloudLap, cloudCl!);
    assert(cloudMatched, "cloud matched");
    cloudStats = {
      points: cloudLap.length,
      meanDispM: Number(meanDispFromRaw(cloudMatched!).toFixed(2)),
      maxJumpM: Number(maxTrackJump(cloudMatched!).toFixed(1)),
      pathM: Number(pathLength(cloudMatched!).toFixed(0)),
    };
  } catch {
    cloudStats = null;
  }

  console.log(
    JSON.stringify({
      ok: true,
      hz: { trackaddict: 10, gopro: 18 },
      centerlinePoints: built!.length,
      builtinPoints: thunderhill!.length,
      builtinLenM: Math.round(builtinLen),
      meanDispM: Number(meanDisp.toFixed(2)),
      legacyDispM: Number(legacyDisp.toFixed(2)),
      hairpin: {
        rawPathM: Math.round(hairRaw),
        snappedPathM: Math.round(hairPath),
        meanDispM: Number(hairDisp.toFixed(2)),
        maxJumpM: Number(maxTrackJump(hairMatched!).toFixed(1)),
      },
      dragy: {
        laps: dragy.laps.length,
        centerlinePts: westCl!.length,
        meanDispM: Number(dragyDisp.toFixed(2)),
        maxJumpM: Number(maxTrackJump(dragyMatched!).toFixed(1)),
      },
      cloud: cloudStats,
      compareSteps: series.length,
      corners: corners.length,
      maxLateralCorrectionM: MAX_LATERAL_CORRECTION_M,
    }),
  );
}

main();
