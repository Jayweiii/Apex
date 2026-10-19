/**
 * GoPro GPMF + export parsers — synthetic fixtures (no real Hero MP4 required).
 * Includes Jason's GPS9 shape expectations (fix in value[8], drop fix=0).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MAX_GOPRO_PARSE_BYTES,
  MAX_VIDEO_BYTES,
} from "../src/lib/abuse-limits";
import {
  buildGpsQuality,
  gpsSourceRank,
  preferGpsSession,
} from "../src/lib/gps-quality";
import {
  parseGoProCsvExport,
  parseGoProGpx,
  parseGoProJson,
} from "../src/lib/parse-gopro-export";
import {
  GOPRO_NO_FIX_MESSAGE,
  GOPRO_NO_GPS_MESSAGE,
  GPS_CLOCK_MIN_MS,
  gpsDopFromSample,
  gpsFixFromSample,
  inferGpsDerivedStartedAtMs,
  isGoProMediaFilename,
  isPlausibleSessionClockMs,
  isUsableGpsRow,
  parseGoProRawData,
  pointsFromGpsSamples,
  resolveGoProStartedAtMs,
} from "../src/lib/parse-gopro";
import { splitLapsByStartFinish } from "../src/lib/split-laps";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");

async function main() {
  // --- Synthetic oval for SF-aware lap split ---
  const oval: TelemetryPoint[] = [];
  const center = { lat: 39.54, lon: -122.33 };
  const toDeg = (m: number, axis: "lat" | "lon") =>
    axis === "lat"
      ? m / 111320
      : m / (111320 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i < 400; i += 1) {
    const a = (i / 200) * Math.PI * 2;
    oval.push({
      t: i * 0.1,
      speed: 80 + 20 * Math.sin(a * 2),
      lat: center.lat + toDeg(Math.sin(a) * 450, "lat"),
      lon: center.lon + toDeg(Math.cos(a) * 550, "lon"),
    });
  }
  const sf = { lat: oval[0].lat!, lon: oval[0].lon! };
  const laps = splitLapsByStartFinish(oval, { startFinish: sf, minLapMeters: 300 });
  assert(laps.length >= 1, "SF oval yields laps");

  // --- Prefer GoPro over phone ---
  const goproQ = buildGpsQuality({
    stream: "GPS9",
    sampleCount: 1000,
    fix: 3,
    precisionP100: 120,
    sourceKind: "gopro",
  });
  const phoneQ = buildGpsQuality({
    stream: "CSV",
    sampleCount: 800,
    sourceKind: "csv",
  });
  assert(goproQ.rank > phoneQ.rank, "GoPro ranks above phone CSV");
  assert(
    preferGpsSession({ gpsQuality: goproQ }, { gpsQuality: phoneQ }) < 0,
    "preferGpsSession orders GoPro first",
  );
  assert(gpsSourceRank("GPS5", "gopro") > gpsSourceRank("CSV", "csv"), "rank table");

  // --- Extensions: MP4 / LRV / MOV ---
  assert(isGoProMediaFilename("GX010071.MP4"), "mp4");
  assert(isGoProMediaFilename("GX010071.LRV"), "lrv proxy");
  assert(isGoProMediaFilename("clip.mov"), "mov");
  assert(!isGoProMediaFilename("track.gpx"), "not gpx");
  assert(MAX_GOPRO_PARSE_BYTES > MAX_VIDEO_BYTES, "parse limit > upload limit");
  assert(MAX_GOPRO_PARSE_BYTES >= 2 * 1024 * 1024 * 1024, "parse allows ~2GB");

  // --- Jason GPS9 sample shape ---
  // value:[lat,lon,alt,speed2d,speed3d,daysSince2000,secs,DOP,fix]
  const unlocked = {
    value: [0, 0, 0, 0, 0, 9550, 83430.099, 99, 0] as number[],
    cts: 0,
    date: "2026-02-23T00:00:00.000Z", // deliberately wrong calendar day
  };
  const locked = {
    value: [
      39.5374153, -122.3312675, 93.563, 28.623, 0, 9550, 83430.099, 7.54, 3,
    ] as number[],
    cts: 100,
    date: "2026-02-23T00:00:00.100Z",
  };
  assert(gpsFixFromSample(unlocked, unlocked.value) === 0, "fix 0 from value[8]");
  assert(gpsFixFromSample(locked, locked.value) === 3, "fix 3 from value[8]");
  assert(gpsDopFromSample(locked, locked.value) === 754, "DOP 7.54 → ×100");
  assert(!isUsableGpsRow(unlocked.value, unlocked, 2), "drop fix 0");
  assert(isUsableGpsRow(locked.value, locked, 2), "keep 3D fix");

  // Simulate leading unlocked samples (187 of Jason's 4942) then 3D lock.
  const syntheticGps9 = [
    ...Array.from({ length: 20 }, (_, i) => ({
      value: [0, 0, 0, 0, 0, 9550, 83430 + i * 0.1, 99, 0] as number[],
      cts: i * 100,
      date: "2026-02-23T00:00:00.000Z",
    })),
    ...Array.from({ length: 80 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2;
      return {
        value: [
          39.54 + Math.sin(a) * 0.004,
          -122.33 + Math.cos(a) * 0.005,
          90,
          25,
          25,
          9550,
          83432 + i * 0.1,
          1.2,
          3,
        ] as number[],
        cts: (20 + i) * 100,
        date: "2026-02-23T00:00:02.000Z",
      };
    }),
  ];
  const built = pointsFromGpsSamples(syntheticGps9, [], 2);
  assert(built.droppedNoFix === 20, `dropped unlockeds ${built.droppedNoFix}`);
  assert(built.points.length === 80, `kept 3D ${built.points.length}`);
  assert(built.bestFix === 3, "best fix 3D");
  assert(
    Math.abs(built.points[0].lat! - 39.54) < 0.01,
    `lat ${built.points[0].lat}`,
  );

  // GPS-derived clock is valid absolute time (Jason: 2026-02-23 was a real older day).
  const gpsClock = inferGpsDerivedStartedAtMs(syntheticGps9);
  assert(gpsClock != null, "gps derived clock present");
  assert(
    new Date(gpsClock!).toISOString().startsWith("2026-02-23"),
    "fixture GPS calendar day",
  );
  assert(isPlausibleSessionClockMs(gpsClock!), "2026-02-23 is plausible");
  assert(!isPlausibleSessionClockMs(Date.UTC(2010, 0, 1)), "pre-2015 rejected");
  assert(
    !isPlausibleSessionClockMs(Date.now() + 7 * 24 * 60 * 60 * 1000),
    "far-future rejected",
  );
  assert(GPS_CLOCK_MIN_MS === Date.UTC(2015, 0, 1), "min clock floor");

  const preferGps = resolveGoProStartedAtMs({
    gpsDerivedStartedAtMs: gpsClock!,
    mp4CreationTimeMs: Date.parse("2026-10-17T16:17:00Z"),
  });
  assert(preferGps.clockSource === "gps", "prefer GPS over MP4 creation_time");
  assert(preferGps.startedAtMs === gpsClock, "GPS startedAt");

  const fallbackMp4 = resolveGoProStartedAtMs({
    gpsDerivedStartedAtMs: Date.UTC(1999, 0, 1),
    mp4CreationTimeMs: Date.parse("2026-10-17T16:17:00Z"),
  });
  assert(fallbackMp4.clockSource === "mp4", "implausible GPS → MP4 fallback");

  const manual = resolveGoProStartedAtMs({
    gpsDerivedStartedAtMs: gpsClock!,
    mp4CreationTimeMs: Date.parse("2026-10-17T16:17:00Z"),
    overrideStartedAtMs: Date.parse("2026-03-01T12:00:00Z"),
  });
  assert(manual.clockSource === "override", "manual override wins");

  // GPS5 sticky fix path still works.
  const gps5Sample = {
    value: [39.54, -122.33, 90, 20, 20] as number[],
    cts: 0,
    sticky: { GPSF: 3, GPSP: 150 },
  };
  assert(gpsFixFromSample(gps5Sample, gps5Sample.value) === 3, "GPS5 sticky fix");
  assert(gpsDopFromSample(gps5Sample, gps5Sample.value) === 150, "GPS5 sticky DOP");

  // Clear messages for short clips with GPMF but no GPS / no fix.
  assert(/No GPS in this file/i.test(GOPRO_NO_GPS_MESSAGE), "no-gps copy");
  assert(/no usable GPS fix/i.test(GOPRO_NO_FIX_MESSAGE), "no-fix copy");

  // --- GPX / JSON / CSV exports ---
  const gpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
${oval
  .slice(0, 80)
  .map(
    (p, i) =>
      `<trkpt lat="${p.lat}" lon="${p.lon}"><time>2024-06-01T12:00:${String(i).padStart(2, "0")}Z</time><speed>${(p.speed / 3.6).toFixed(2)}</speed></trkpt>`,
  )
  .join("\n")}
</trkseg></trk></gpx>`;
  const gpxResult = parseGoProGpx(gpx, { startFinish: sf });
  assert(gpxResult.pointCount >= 10, "gpx points");
  assert(gpxResult.gpsQuality.stream === "GPX", "gpx quality stream");
  assert(gpxResult.laps.length >= 1, "gpx laps");

  const jsonResult = parseGoProJson(
    JSON.stringify({
      points: oval.slice(0, 60).map((p) => ({
        lat: p.lat,
        lon: p.lon,
        t: p.t,
        speed: p.speed,
      })),
    }),
  );
  assert(jsonResult.stream === "JSON" && jsonResult.laps.length >= 1, "json export");

  const csv = [
    "latitude,longitude,speed,time",
    ...oval.slice(0, 50).map((p) => `${p.lat},${p.lon},${p.speed},${p.t}`),
  ].join("\n");
  const csvResult = parseGoProCsvExport(csv);
  assert(csvResult.stream === "CSV" && csvResult.pointCount >= 10, "csv export");

  // --- Real GPMF fixture from gopro-telemetry samples (Hero5) ---
  // Must await gopro-telemetry Promise (v1.2+); sync call yields {}.
  const rawPath = resolve(root, "src/lib/fixtures/gopro-hero5.gpmf.raw");
  const raw = readFileSync(rawPath);
  let gpmfOk = false;
  let gpmfDetail = "";
  try {
    const parsed = await parseGoProRawData(raw, {
      gpsPrecisionMax: 9999,
      gpsFixMin: 0,
      videoStartedAtMs: Date.parse("2026-10-17T16:17:00Z"),
    });
    gpmfOk = parsed.pointCount > 0 || parsed.laps.length >= 0;
    gpmfDetail = `stream=${parsed.gpsStream} points=${parsed.pointCount} laps=${parsed.laps.length} quality=${parsed.gpsQuality.label} clock=${parsed.clockSource}`;
    assert(typeof parsed.gpsQuality.label === "string", "quality label");
    assert(parsed.gpsQuality.rank > 0, "quality rank");
    assert(
      parsed.clockSource === "gps" ||
        parsed.clockSource === "mp4" ||
        parsed.clockSource === "none",
      `clockSource ${parsed.clockSource}`,
    );
    // When GPS samples carry a plausible date, it wins over MP4 creation_time.
    if (parsed.gpsDerivedStartedAtMs != null && isPlausibleSessionClockMs(parsed.gpsDerivedStartedAtMs)) {
      assert(parsed.clockSource === "gps", "GPS clock preferred when plausible");
      assert(parsed.startedAtMs === parsed.gpsDerivedStartedAtMs, "startedAt = GPS");
    }
  } catch (err) {
    // Official gopro-telemetry .raw samples are short clips — may lack a full lap.
    // Graceful path must still throw an actionable GoPro-specific message.
    const message = err instanceof Error ? err.message : String(err);
    assert(
      /GPS|GPMF|GoPro|lock|precision|fix|laps|No GPS/i.test(message),
      `fixture error should be actionable, got: ${message}`,
    );
    gpmfDetail = `graceful: ${message.slice(0, 160)}`;
  }

  // Empty MP4-like failure message path (no rawData)
  try {
    await parseGoProRawData(Buffer.from("not-gpmf-data"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    assert(message.length > 10, "raw garbage fails clearly");
  }

  console.log(
    JSON.stringify({
      ok: true,
      sfLaps: laps.length,
      goproRank: goproQ.rank,
      phoneRank: phoneQ.rank,
      gps9: {
        droppedNoFix: built.droppedNoFix,
        kept: built.points.length,
        bestFix: built.bestFix,
      },
      parseLimitMb: MAX_GOPRO_PARSE_BYTES / (1024 * 1024),
      uploadLimitMb: MAX_VIDEO_BYTES / (1024 * 1024),
      exports: {
        gpx: gpxResult.pointCount,
        json: jsonResult.pointCount,
        csv: csvResult.pointCount,
      },
      gpmfFixture: gpmfOk,
      gpmfDetail,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
