/**
 * Full-res source_gps: columnar gzip encoding, no downsample, GL010057 rate check.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  compactSourceGps,
  compactSourceGpsIfDense,
  expandSourceGps,
  isSourceGpsDenseEnough,
  resolveGpsForReparse,
  sourceGpsPointCount,
  sourceGpsPayloadBytes,
  stitchLapTelemetry,
} from "../src/lib/session-reparse";
import type { TelemetryPoint } from "../src/lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const root = resolve(import.meta.dirname, "..");
const fixtureCandidates = [
  "/cursor/stores/self/fixtures/GL010057-session-gps.json",
  "/cursor/stores/bc-01a11078-b57e-7e44-822b-3deeed880a3d/fixtures/GL010057-session-gps.json",
  resolve(root, "src/lib/fixtures/gopro-thunderhill-west-session-gps.json"),
];
const fixturePath = fixtureCandidates.find((p) => existsSync(p));
assert(fixturePath, "GL010057 / thunderhill GPS fixture missing");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  pointCount?: number;
  points: Array<{
    t: number;
    lat: number;
    lon: number;
    speed: number;
    alt?: number;
    heading?: number;
  }>;
};

const points: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
  alt: p.alt,
  heading: p.heading,
}));

const durationSec = points[points.length - 1]!.t - points[0]!.t;
const hz = durationSec > 0 ? (points.length - 1) / durationSec : 0;

const encoded = compactSourceGps(points);
assert(encoded, "encode produces v2 blob");
assert(encoded.v === 2, "v2");
assert(encoded.enc === "col-d32-gz-b64", "gzip columnar encoding");
assert(encoded.n === points.length, "encode keeps every GPS sample (no downsample)");
assert(encoded.ch.includes("t") && encoded.ch.includes("lat") && encoded.ch.includes("lon"), "core channels");
assert(encoded.ch.includes("s"), "speed channel");

const roundTrip = expandSourceGps(encoded);
assert(roundTrip.length === points.length, "decode point count");
assert(
  Math.abs(roundTrip[10]!.lat! - points[10]!.lat!) < 1e-6,
  "lat preserved through delta scale",
);
assert(
  Math.abs(roundTrip[10]!.speed - points[10]!.speed) < 0.02,
  "speed preserved",
);

// Rate check: stored count ≈ duration × fixture rate (no downsample)
const expectedApprox = Math.round(durationSec * hz) + 1;
assert(
  Math.abs(encoded.n - expectedApprox) <= 2,
  `point count ≈ duration*rate (got ${encoded.n}, expect ~${expectedApprox} at ${hz.toFixed(2)} Hz over ${durationSec.toFixed(1)}s)`,
);
assert(
  isSourceGpsDenseEnough(roundTrip).ok,
  `GL010057 fixture must be dense enough to re-split (${hz.toFixed(2)} Hz)`,
);

// Legacy v1 array still expands
const legacy = expandSourceGps([
  { t: 0, lat: 39.5, lon: -122.3, s: 40 },
  { t: 1, lat: 39.5001, lon: -122.3001, s: 50 },
]);
assert(legacy.length === 2, "legacy v1 expand");

// Coarse stitch must NOT become source_gps
const coarseLap = points.filter((_, i) => i % 80 === 0).slice(0, 12);
assert(coarseLap.length >= 8, "coarse sample");
const stitched = stitchLapTelemetry([
  { lap_number: 1, start_offset_sec: 0, telemetry: coarseLap },
]);
assert(!compactSourceGpsIfDense(stitched), "refuse to store coarse stitch as source_gps");

const fromCoarseSource = resolveGpsForReparse({
  sourceGps: compactSourceGps(stitched), // encode anyway for density probe
  laps: [],
});
// compactSourceGps still encodes; density gate is separate
assert(
  sourceGpsPointCount(compactSourceGps(stitched)) === stitched.length,
  "point count matches stitch length",
);

const repairedBug = resolveGpsForReparse({
  sourceGps: Array.from({ length: 144 }, (_, i) => ({
    t: i * 8,
    lat: 39.53 + i * 1e-5,
    lon: -122.33,
    s: 80,
  })),
  laps: [
    {
      lap_number: 1,
      start_offset_sec: 0,
      telemetry: points.slice(0, 400),
    },
  ],
});
assert(repairedBug.from === "source_gps", "prefers stored source_gps even when coarse");
assert(!repairedBug.density.ok, "144 pts over ~20 min is too coarse → file picker");
assert(
  !compactSourceGpsIfDense(repairedBug.points),
  "reparse must not re-write coarse 144-pt blob as source_gps",
);

// Optional channels round-trip
const withExtras: TelemetryPoint[] = points.slice(0, 200).map((p, i) => ({
  ...p,
  alt: 100 + i * 0.1,
  heading: (i * 3) % 360,
  latG: Math.sin(i / 10) * 0.5,
  lonG: Math.cos(i / 10) * 0.3,
}));
const extrasBlob = compactSourceGps(withExtras);
assert(extrasBlob?.ch.includes("alt"), "alt channel");
assert(extrasBlob?.ch.includes("hdg"), "heading channel");
assert(extrasBlob?.ch.includes("a") && extrasBlob?.ch.includes("b"), "accel channels");
const extrasBack = expandSourceGps(extrasBlob);
assert(Math.abs((extrasBack[50]!.alt ?? 0) - withExtras[50]!.alt!) < 0.02, "alt round-trip");
assert(
  Math.abs((extrasBack[50]!.heading ?? 0) - withExtras[50]!.heading!) < 0.02,
  "heading round-trip",
);

const bytes = sourceGpsPayloadBytes(encoded);
assert(bytes > 0 && bytes < 500_000, `fixture compact size sane (${bytes} bytes)`);

const outDir = resolve(root, "artifacts/source-gps");
mkdirSync(outDir, { recursive: true });
const summary = {
  ok: true,
  fixture: fixturePath,
  pointCount: encoded.n,
  durationSec: Number(durationSec.toFixed(3)),
  hz: Number(hz.toFixed(3)),
  expectedApprox,
  payloadBytes: bytes,
  channels: encoded.ch,
  note:
    "Live GL010057.LRV parse previously reported gps_quality.sampleCount=12030 (~10 Hz). This fixture is a ~4 Hz reconstruction; encode preserves every fixture sample.",
  session1aa2fb88:
    "Cannot rebuild full-res: no raw_object_key / LRV in storage. Cleared coarse 144-pt source_gps; owner must re-select GL010057.LRV once, then source_gps stays full-res.",
};
writeFileSync(resolve(outDir, "gl010057-encode-summary.json"), JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log("verify-source-gps-fullres: ok");
