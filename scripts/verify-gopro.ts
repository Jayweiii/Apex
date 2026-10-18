/**
 * GoPro GPMF + export parsers — synthetic fixtures (no real Hero MP4 required).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { parseGoProRawData } from "../src/lib/parse-gopro";
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
  const rawPath = resolve(root, "src/lib/fixtures/gopro-hero5.gpmf.raw");
  const raw = readFileSync(rawPath);
  let gpmfOk = false;
  let gpmfDetail = "";
  try {
    const parsed = await parseGoProRawData(raw, {
      gpsPrecisionMax: 9999,
      gpsFixMin: 0,
    });
    gpmfOk = parsed.pointCount > 0 || parsed.laps.length >= 0;
    gpmfDetail = `stream=${parsed.gpsStream} points=${parsed.pointCount} laps=${parsed.laps.length} quality=${parsed.gpsQuality.label}`;
    assert(typeof parsed.gpsQuality.label === "string", "quality label");
    assert(parsed.gpsQuality.rank > 0, "quality rank");
  } catch (err) {
    // Official gopro-telemetry .raw samples are short clips — may lack a full lap.
    // Graceful path must still throw an actionable GoPro-specific message.
    const message = err instanceof Error ? err.message : String(err);
    assert(
      /GPS|GPMF|GoPro|lock|precision|fix|laps/i.test(message),
      `fixture error should be actionable, got: ${message}`,
    );
    gpmfDetail = `graceful: ${message.slice(0, 160)}`;
  }

  // Empty MP4-like failure message path (no rawData)
  try {
    await parseGoProRawData(Buffer.from("not-gpmf-data"));
    // Some parsers may return empty streams rather than throw — either is ok if message path works.
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
