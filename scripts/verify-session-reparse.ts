/**
 * Re-parse laps from full GPS + preserve YouTube/trim/exclude by lap number.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReparsedLapRows,
  compactSourceGps,
  expandSourceGps,
  isSourceGpsDenseEnough,
  looksLikeUnsplitLaps,
  preserveMatchedLapSideData,
  remapVideosByLapNumber,
  reparseLapsFromPoints,
  resolveGpsForReparse,
  stitchLapTelemetry,
  UNSPLIT_LAP_HINT_MS,
} from "../src/lib/session-reparse";
import { isSessionOwner } from "../src/lib/session-owner";
import type { SessionVideo, TelemetryPoint } from "../src/lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const fixturePath = resolve(
  import.meta.dirname,
  "../src/lib/fixtures/gopro-thunderhill-west-session-gps.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  expectedHotLaps: number;
  pointCount: number;
  points: Array<{ t: number; lat: number; lon: number; speed: number }>;
};

const points: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
}));

const compact = compactSourceGps(points);
assert(compact, "compact encodes");
assert(compact.n === points.length, "compact keeps GPS samples");
assert(compact.v === 2, "v2 encoding");
const expanded = expandSourceGps(compact);
assert(expanded.length === points.length, "expand round-trip");
assert(
  Math.abs(expanded[10].lat! - points[10].lat!) < 1e-6,
  "lat preserved",
);

const density = isSourceGpsDenseEnough(points);
assert(density.ok, `fixture should be dense (${density.hz} Hz)`);

const split = reparseLapsFromPoints(points, {
  startFinish: { lat: 39.53905, lon: -122.3387 },
  trackId: "thunderhill-west",
});
assert(split.laps.length >= 8, `expected many laps, got ${split.laps.length}`);
console.log(
  `reparse fixture: ${split.laps.length} laps (expectedHot≈${fixture.expectedHotLaps})`,
);

const giant = stitchLapTelemetry([
  {
    lap_number: 1,
    start_offset_sec: 0,
    telemetry: split.laps[0].points.slice(0, 40),
  },
]);
const coarse = isSourceGpsDenseEnough(giant);
assert(!coarse.ok, "tiny stitched set should be too coarse");

const fromSource = resolveGpsForReparse({
  sourceGps: compact,
  laps: [
    {
      lap_number: 1,
      start_offset_sec: 0,
      telemetry: split.laps[0].points,
    },
  ],
});
assert(fromSource.from === "source_gps", "prefers source_gps");
assert(fromSource.density.ok, "source_gps dense");

const lap2 = split.laps.find((l) => l.lapNumber === 2);
const lap3 = split.laps.find((l) => l.lapNumber === 3);
assert(lap2 && lap3, "laps 2 and 3 exist for side-data checks");
const previous = [
  {
    lap_number: 2,
    excluded: true,
    exclude_reason: "inlap",
    start_offset_override: (lap2!.startOffsetSec ?? 0) + 1,
    end_offset_override: null as number | null,
    auto_start: lap2!.startOffsetSec ?? 0,
    auto_end:
      (lap2!.startOffsetSec ?? 0) +
      (lap2!.points[lap2!.points.length - 1]?.t ?? lap2!.lapTimeMs / 1000),
  },
  {
    lap_number: 3,
    excluded: false,
    exclude_reason: null as string | null,
    start_offset_override: null as number | null,
    end_offset_override: 200,
    auto_start: lap3!.startOffsetSec ?? 0,
    auto_end:
      (lap3!.startOffsetSec ?? 0) +
      (lap3!.points[lap3!.points.length - 1]?.t ?? lap3!.lapTimeMs / 1000),
  },
];
const preserved = preserveMatchedLapSideData(previous, split.laps);
assert(preserved.get(2)?.excluded === true, "exclude preserved on lap 2");
assert(
  preserved.get(3)?.end_offset_override === 200,
  "trim end preserved on lap 3 when bounds unchanged",
);

// Giant single-lap trim must not survive a multi-lap re-split.
const giantPrev = [
  {
    lap_number: 1,
    excluded: false,
    exclude_reason: null as string | null,
    start_offset_override: 0,
    end_offset_override: 1200,
    auto_start: 0,
    auto_end: 1200,
  },
];
const afterGiant = preserveMatchedLapSideData(giantPrev, split.laps);
assert(
  afterGiant.get(1)?.start_offset_override == null &&
    afterGiant.get(1)?.end_offset_override == null,
  "stale giant-lap trim cleared after re-split",
);

const rows = buildReparsedLapRows("user", "sess", split.laps, preserved);
assert(rows.length === split.laps.length, "row count");
assert(rows[1].excluded === true, "row 2 excluded");

const videos: SessionVideo[] = [
  {
    id: "v1",
    provider: "youtube",
    youtubeId: "abc",
    lapId: "old-lap-2",
    lapIndex: 2,
    offsetSec: 12.5,
    syncSource: "manual",
  },
  {
    id: "v2",
    provider: "youtube",
    youtubeId: "def",
    lapId: null,
    offsetSec: 0,
    syncSource: "auto",
  },
];
const nextIds = new Map(
  split.laps.map((lap) => [lap.lapNumber, `new-${lap.lapNumber}`]),
);
const remapped = remapVideosByLapNumber(
  videos,
  new Map([["old-lap-2", 2]]),
  nextIds,
);
assert(remapped[0].lapId === "new-2", "youtube remapped by lap number");
assert(remapped[0].offsetSec === 12.5, "offset kept");
assert(remapped[1].lapId == null, "session-level video untouched");

async function smokeLrv() {
  // Prefer real LRV when GPS is present; fixture already validated re-split.
  const candidates = [
    "/tmp/GL010182.LRV",
    "/tmp/GL010183.LRV",
    "/tmp/GL010184.LRV",
    "/tmp/GL010185.LRV",
  ];
  const { parseGoProFile } = await import("../src/lib/parse-gopro");
  for (const lrvPath of candidates) {
    if (!existsSync(lrvPath)) continue;
    const size = readFileSync(lrvPath).byteLength;
    if (size > 900_000) {
      console.log(`LRV ${lrvPath}: skip large (${size} bytes) in unit smoke`);
      continue;
    }
    try {
      const parsed = await Promise.race([
        parseGoProFile(readFileSync(lrvPath), {
          trackId: "thunderhill-west",
          startFinish: { lat: 39.53905, lon: -122.3387 },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 8000),
        ),
      ]);
      if (!parsed.sourcePoints || parsed.sourcePoints.length < 20) {
        console.log(`LRV ${lrvPath}: sparse GPS (${parsed.sourcePoints?.length ?? 0})`);
        continue;
      }
      console.log(
        `LRV ${lrvPath}: ${parsed.laps.length} laps, ${parsed.sourcePoints.length} source GPS pts`,
      );
      return;
    } catch (err) {
      console.log(
        `LRV ${lrvPath}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
  console.log(
    "LRV smoke: no usable moving GPS in small /tmp GL01*.LRV — fixture reparse covers split",
  );
}

assert(
  looksLikeUnsplitLaps([{ lap_time_ms: UNSPLIT_LAP_HINT_MS + 1 }]),
  "single long lap looks unsplit",
);
assert(
  !looksLikeUnsplitLaps([{ lap_time_ms: UNSPLIT_LAP_HINT_MS - 1 }]),
  "short single lap is not unsplit hint",
);
assert(
  !looksLikeUnsplitLaps([
    { lap_time_ms: 120_000 },
    { lap_time_ms: 121_000 },
  ]),
  "multi-lap session is not unsplit",
);
assert(
  isSessionOwner(
    "7a23f279-c3c6-428d-82d6-1823cc8b3fd1",
    "7A23F279-C3C6-428D-82D6-1823CC8B3FD1",
  ),
  "owner id compare is case-insensitive",
);
assert(!isSessionOwner("a", null), "missing auth is not owner");
assert(!isSessionOwner(null, "a"), "missing session user is not owner");

void smokeLrv()
  .then(() => {
    console.log("verify-session-reparse: ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
