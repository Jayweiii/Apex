/**
 * GPS logger importers: GPX, VBO, Dragy CSV, .dlap rejection + PNG hints.
 */
import { deflateSync } from "node:zlib";
import {
  buildGpsQuality,
  gpsSourceRank,
} from "../src/lib/gps-quality";
import {
  detectGpsLoggerFormat,
  humanizeTrackToken,
  inspectDlap,
  listZipFilenames,
  parseDlapPngHints,
  parseDragyCsv,
  parseGpxLogger,
  parseVbo,
  vboCoordToDegrees,
} from "../src/lib/parse-gps-logger";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ovalPoints(n = 80): TelemetryPoint[] {
  const center = { lat: 39.54, lon: -122.33 };
  const toDeg = (m: number, axis: "lat" | "lon") =>
    axis === "lat"
      ? m / 111320
      : m / (111320 * Math.cos((center.lat * Math.PI) / 180));
  const out: TelemetryPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = (i / (n / 2)) * Math.PI * 2;
    out.push({
      t: i * 0.1,
      speed: 80 + 20 * Math.sin(a * 2),
      lat: center.lat + toDeg(Math.sin(a) * 450, "lat"),
      lon: center.lon + toDeg(Math.cos(a) * 550, "lon"),
    });
  }
  return out;
}

/** Minimal store-only ZIP (uncompressed) with given filenames. */
function makeZip(entries: Array<{ name: string; data?: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const data = entry.data ?? new Uint8Array(0);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    local[0] = 0x50;
    local[1] = 0x4b;
    local[2] = 0x03;
    local[3] = 0x04;
    local[8] = 0; // stored
    local[18] = data.length & 0xff;
    local[19] = (data.length >> 8) & 0xff;
    local[20] = (data.length >> 16) & 0xff;
    local[21] = (data.length >> 24) & 0xff;
    local[22] = local[18];
    local[23] = local[19];
    local[24] = local[20];
    local[25] = local[21];
    local[26] = nameBytes.length & 0xff;
    local[27] = (nameBytes.length >> 8) & 0xff;
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    parts.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    cd[0] = 0x50;
    cd[1] = 0x4b;
    cd[2] = 0x01;
    cd[3] = 0x02;
    cd[20] = data.length & 0xff;
    cd[21] = (data.length >> 8) & 0xff;
    cd[22] = (data.length >> 16) & 0xff;
    cd[23] = (data.length >> 24) & 0xff;
    cd[24] = cd[20];
    cd[25] = cd[21];
    cd[26] = cd[22];
    cd[27] = cd[23];
    cd[28] = nameBytes.length & 0xff;
    cd[29] = (nameBytes.length >> 8) & 0xff;
    cd[42] = offset & 0xff;
    cd[43] = (offset >> 8) & 0xff;
    cd[44] = (offset >> 16) & 0xff;
    cd[45] = (offset >> 24) & 0xff;
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const eocd = new Uint8Array(22);
  eocd[0] = 0x50;
  eocd[1] = 0x4b;
  eocd[2] = 0x05;
  eocd[3] = 0x06;
  eocd[8] = entries.length & 0xff;
  eocd[9] = (entries.length >> 8) & 0xff;
  eocd[10] = eocd[8];
  eocd[11] = eocd[9];
  eocd[12] = cdSize & 0xff;
  eocd[13] = (cdSize >> 8) & 0xff;
  eocd[14] = (cdSize >> 16) & 0xff;
  eocd[15] = (cdSize >> 24) & 0xff;
  eocd[16] = cdStart & 0xff;
  eocd[17] = (cdStart >> 8) & 0xff;
  eocd[18] = (cdStart >> 16) & 0xff;
  eocd[19] = (cdStart >> 24) & 0xff;

  const total = offset + cdSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  for (const c of central) {
    out.set(c, pos);
    pos += c.length;
  }
  out.set(eocd, pos);
  return out;
}

async function main() {
  const oval = ovalPoints(100);
  const sf = { lat: oval[0].lat!, lon: oval[0].lon! };

  // --- VBO minutes → degrees ---
  assert(Math.abs(vboCoordToDegrees(36.5) - 36.5) < 1e-9, "deg passthrough");
  assert(
    Math.abs(vboCoordToDegrees(2192.4) - 2192.4 / 60) < 1e-9,
    "minutes → deg",
  );

  // --- GPX ---
  const gpx = `<?xml version="1.0"?>
<gpx><trk><trkseg>
${oval
  .slice(0, 60)
  .map(
    (p, i) =>
      `<trkpt lat="${p.lat}" lon="${p.lon}"><time>2024-06-01T12:00:${String(Math.min(59, i)).padStart(2, "0")}Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:speed>${(p.speed / 3.6).toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension></extensions></trkpt>`,
  )
  .join("\n")}
</trkseg></trk></gpx>`;
  assert(detectGpsLoggerFormat("run.gpx", gpx) === "gpx", "detect gpx");
  const gpxResult = parseGpxLogger(gpx, { startFinish: sf });
  assert(gpxResult.pointCount >= 10, "gpx points");
  assert(gpxResult.gpsQuality.stream === "GPX", "gpx stream");
  assert(gpxResult.laps.length >= 1, "gpx laps");

  // --- VBO ---
  const vbo = `[header]
File created by Apex synthetic
[column names]
sats time latitude longitude velocity heading height
[data]
${oval
  .slice(0, 70)
  .map((p, i) => {
    // store as minutes (RaceLogic style)
    const latMin = p.lat! * 60;
    const lonMin = p.lon! * 60;
    return `8 ${(i * 0.1).toFixed(3)} ${latMin.toFixed(6)} ${lonMin.toFixed(6)} ${p.speed.toFixed(2)} 90.0 100.0`;
  })
  .join("\n")}
`;
  assert(detectGpsLoggerFormat("session.vbo", vbo) === "vbo", "detect vbo");
  assert(
    detectGpsLoggerFormat("mystery.txt", vbo) === "vbo",
    "detect vbo by content",
  );
  const vboResult = parseVbo(vbo, { startFinish: sf });
  assert(vboResult.format === "vbo", "vbo format");
  assert(vboResult.gpsQuality.stream === "VBO", "vbo stream");
  assert(vboResult.pointCount >= 10, "vbo points");
  assert(vboResult.laps.length >= 1, "vbo laps");
  assert(
    Math.abs(vboResult.laps[0].points[0].lat! - oval[0].lat!) < 0.01,
    "vbo lat converted from minutes",
  );

  // --- Dragy CSV ---
  const dragy = [
    "Time,Latitude,Longitude,Speed (km/h),Heading,Altitude",
    ...oval.slice(0, 55).map((p, i) => {
      const ms = Date.parse("2026-10-17T16:18:29Z") + i * 100;
      return `${new Date(ms).toISOString()},${p.lat},${p.lon},${p.speed},180,100`;
    }),
  ].join("\n");
  assert(
    detectGpsLoggerFormat("dragy_export.csv", dragy) === "dragy-csv",
    "detect dragy",
  );
  const dragyResult = parseDragyCsv(dragy, { startFinish: sf });
  assert(dragyResult.gpsQuality.stream === "DRAGY", "dragy stream");
  assert(dragyResult.pointCount >= 10, "dragy points");
  assert(dragyResult.laps.length >= 1, "dragy laps");
  assert(dragyResult.sessionDate === "2026-10-17", "dragy session date");

  // Rank: VBO/Dragy above phone CSV
  assert(
    gpsSourceRank("VBO") > gpsSourceRank("CSV", "csv"),
    "VBO > phone",
  );
  assert(
    gpsSourceRank("DRAGY") > gpsSourceRank("CSV", "csv"),
    "Dragy > phone",
  );
  assert(
    buildGpsQuality({ stream: "VBO", sampleCount: 10, sourceKind: "logger" })
      .label.includes("VBO"),
    "vbo label",
  );

  // --- PNG name hints ---
  assert(
    humanizeTrackToken("ThunderhillRacewayParkWest") ===
      "Thunderhill Raceway Park West",
    "humanize track",
  );
  const pngHints = parseDlapPngHints([
    "ThunderhillRacewayParkWest_20261017161829.png",
  ]);
  assert(
    pngHints.trackNameHint === "Thunderhill Raceway Park West",
    "png track hint",
  );
  assert(pngHints.sessionDateHint === "2026-10-17", "png date hint");

  // --- .dlap zip rejection ---
  const zip = makeZip([
    { name: "ThunderhillRacewayParkWest_20261017161829.png", data: new Uint8Array([1, 2, 3]) },
    { name: "session.group", data: deflateSync(Buffer.from("encrypted-blob")) },
  ]);
  const names = listZipFilenames(zip);
  assert(
    names.some((n) => n.endsWith(".png")) && names.some((n) => n.endsWith(".group")),
    `zip lists png+group, got ${names.join(",")}`,
  );
  const dlap = inspectDlap(zip);
  assert(/CSV|GPX|VBO/i.test(dlap.message), "dlap message suggests export");
  assert(/encrypted|\.group/i.test(dlap.message), "mentions encrypted group");
  assert(
    dlap.trackNameHint === "Thunderhill Raceway Park West",
    "dlap track hint",
  );
  assert(dlap.sessionDateHint === "2026-10-17", "dlap date hint");
  assert(detectGpsLoggerFormat("run.dlap") === "dlap", "detect dlap ext");

  console.log(
    JSON.stringify({
      ok: true,
      gpx: gpxResult.pointCount,
      vbo: vboResult.pointCount,
      dragy: dragyResult.pointCount,
      dlapTrack: dlap.trackNameHint,
      dlapDate: dlap.sessionDateHint,
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
