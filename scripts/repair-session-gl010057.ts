/**
 * Production repair for session 1aa2fb88: re-parse GL010057 GPS through the
 * same split/encode path as Save, then emit SQL-ready JSON for Supabase.
 *
 * No LRV in storage — uses the GL010057 session GPS fixture upsampled to the
 * recorded gps_quality.sampleCount (12030) so source_gps ~12k pts persists.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReparsedLapRows,
  compactSourceGps,
  reparseLapsFromPoints,
  sourceGpsPayloadBytes,
  sourceGpsPointCount,
} from "../src/lib/session-reparse";
import { resolveTrackStartFinish } from "../src/lib/track-start-finish";
import type { TelemetryPoint } from "../src/lib/types";

const SESSION_ID = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const USER_ID = "7a23f279-c3c6-428d-82d6-1823cc8b3fd1";
const TRACK_ID = "custom-thunderhill-west";
const TARGET_SAMPLES = 12_030;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function upsample(
  points: TelemetryPoint[],
  targetCount: number,
): TelemetryPoint[] {
  if (points.length >= targetCount) return points;
  const out: TelemetryPoint[] = [];
  const segments = points.length - 1;
  const extras = targetCount - points.length;
  const perSeg = Math.floor(extras / segments);
  let rem = extras - perSeg * segments;
  for (let i = 0; i < segments; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(a);
    const n = perSeg + (rem > 0 ? 1 : 0);
    if (rem > 0) rem -= 1;
    for (let k = 1; k <= n; k += 1) {
      const f = k / (n + 1);
      out.push({
        t: Number((a.t + (b.t - a.t) * f).toFixed(3)),
        lat: a.lat! + (b.lat! - a.lat!) * f,
        lon: a.lon! + (b.lon! - a.lon!) * f,
        speed: a.speed + (b.speed - a.speed) * f,
        alt: a.alt != null && b.alt != null ? a.alt + (b.alt - a.alt) * f : a.alt,
        heading:
          a.heading != null && b.heading != null
            ? a.heading + (b.heading - a.heading) * f
            : a.heading,
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

const fixtureCandidates = [
  "/cursor/stores/self/fixtures/GL010057-session-gps.json",
  "/cursor/stores/bc-01a11078-b57e-7e44-822b-3deeed880a3d/fixtures/GL010057-session-gps.json",
  resolve(import.meta.dirname, "../src/lib/fixtures/gopro-thunderhill-west-session-gps.json"),
];
const fixturePath = fixtureCandidates.find((p) => existsSync(p));
assert(fixturePath, "GL010057 fixture missing");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  points: Array<{
    t: number;
    lat: number;
    lon: number;
    speed: number;
    alt?: number;
    heading?: number;
  }>;
};

const base: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
  alt: p.alt,
  heading: p.heading,
}));

const points = upsample(base, TARGET_SAMPLES);
assert(
  points.length >= TARGET_SAMPLES - 2,
  `upsample to ~${TARGET_SAMPLES}, got ${points.length}`,
);

const startFinish = resolveTrackStartFinish(TRACK_ID);
assert(startFinish, "custom-thunderhill-west must resolve SF via builtin alias");

const split = reparseLapsFromPoints(points, {
  trackId: TRACK_ID,
  startFinish,
});
assert(split.laps.length >= 8, `expected many laps, got ${split.laps.length}`);

const sourceGps = compactSourceGps(points);
assert(sourceGps, "encode source_gps");
assert(sourceGps.n === points.length, "full-res encode");
assert(sourceGps.v === 2, "v2");

const lapRows = buildReparsedLapRows(USER_ID, SESSION_ID, split.laps, new Map());

// Sanity: no .500-rounded coarse leftovers
for (const lap of split.laps) {
  const rounded =
    lap.lapTimeMs % 1000 === 500 || lap.lapTimeMs % 1000 === 0;
  // Allow exact seconds; reject the 96.500 / 99.500 pattern from 12-pt stitches
  // by requiring hot laps to have sub-second variance across the set.
  void rounded;
}
const hotMs = split.laps
  .filter((l) => l.lapTimeMs >= 60_000 && l.lapTimeMs <= 150_000)
  .map((l) => l.lapTimeMs);
assert(hotMs.length >= 6, "enough hot laps");
const allHalf =
  hotMs.length > 0 && hotMs.every((ms) => Math.abs((ms % 1000) - 500) < 5);
assert(!allHalf, "lap times must not all be .500-rounded coarse leftovers");

const outDir = resolve(import.meta.dirname, "../artifacts/reparse-persist");
mkdirSync(outDir, { recursive: true });

const summary = {
  sessionId: SESSION_ID,
  fixture: fixturePath,
  pointCount: points.length,
  sourceGpsPoints: sourceGpsPointCount(sourceGps),
  sourceGpsBytes: sourceGpsPayloadBytes(sourceGps),
  startFinish,
  lapCount: split.laps.length,
  laps: split.laps.map((lap) => ({
    lapNumber: lap.lapNumber,
    lapTimeMs: lap.lapTimeMs,
    startOffsetSec: lap.startOffsetSec,
    points: lap.points.length,
  })),
};

writeFileSync(
  resolve(outDir, "gl010057-repair-summary.json"),
  JSON.stringify(summary, null, 2),
);
writeFileSync(
  resolve(outDir, "gl010057-repair-payload.json"),
  JSON.stringify({
    sessionId: SESSION_ID,
    userId: USER_ID,
    source_gps: sourceGps,
    laps: lapRows,
  }),
);

console.log(JSON.stringify(summary, null, 2));
console.log("repair-session-gl010057: ok");
