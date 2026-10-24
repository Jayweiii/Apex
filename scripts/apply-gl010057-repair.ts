/**
 * Apply artifacts/reparse-persist/gl010057-repair-payload.json to Supabase
 * via the SQL API helper used by agents (prints statements + writes chunk files).
 *
 * Prefer: npx tsx scripts/apply-gl010057-repair.ts --write-sql
 * then apply each chunk with Supabase execute_sql.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expandSourceGps } from "../src/lib/source-gps-codec";
import { speedChartRenderable } from "../src/lib/hydrate-lap-telemetry";

const SESSION_ID = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const payloadPath = resolve(
  "artifacts/reparse-persist/gl010057-repair-payload.json",
);

const payload = JSON.parse(readFileSync(payloadPath, "utf8")) as {
  source_gps: unknown;
  laps: Array<{
    lap_number: number;
    lap_time_ms: number;
    start_offset_sec: number | null;
    telemetry: Array<{ t: number; speed: number; lat?: number; lon?: number }>;
  }>;
};

const pts = expandSourceGps(payload.source_gps);
if (pts.length < 10_000) throw new Error(`source_gps too small: ${pts.length}`);
const badLon = pts.filter((p) => (p.lon ?? 0) > -100 || (p.lon ?? 0) < -130);
const badSpeed = pts.filter((p) => p.speed < 0 || p.speed > 300);
if (badLon.length || badSpeed.length) {
  throw new Error(
    `payload source_gps still corrupt lon=${badLon.length} speed=${badSpeed.length}`,
  );
}

for (const lap of payload.laps) {
  const check = speedChartRenderable(lap.telemetry);
  if (!check.ok && lap.lap_time_ms >= 30_000) {
    throw new Error(`lap ${lap.lap_number} not chartable: ${check.reason}`);
  }
}

const outDir = resolve("artifacts/reparse-persist/sql-chunks");
mkdirSync(outDir, { recursive: true });

function sqlLiteral(value: unknown): string {
  // Dollar-quote JSON so we never fight escaping.
  const json = JSON.stringify(value);
  let tag = "j";
  while (json.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${json}$${tag}$::jsonb`;
}

const sessionSql = `UPDATE public.sessions
SET source_gps = ${sqlLiteral(payload.source_gps)}
WHERE id = '${SESSION_ID}';
`;
writeFileSync(resolve(outDir, "00-source-gps.sql"), sessionSql);

payload.laps.forEach((lap, index) => {
  const sql = `UPDATE public.laps
SET
  telemetry = ${sqlLiteral(lap.telemetry)},
  lap_time_ms = ${Number(lap.lap_time_ms)},
  start_offset_sec = ${lap.start_offset_sec == null ? "NULL" : Number(lap.start_offset_sec)}
WHERE session_id = '${SESSION_ID}'
  AND lap_number = ${Number(lap.lap_number)};
`;
  const name = `${String(index + 1).padStart(2, "0")}-lap-${lap.lap_number}.sql`;
  writeFileSync(resolve(outDir, name), sql);
});

const manifest = {
  sessionId: SESSION_ID,
  sourcePts: pts.length,
  laps: payload.laps.map((l) => ({
    lap_number: l.lap_number,
    points: l.telemetry.length,
    chartOk: speedChartRenderable(l.telemetry).ok,
  })),
  chunks: ["00-source-gps.sql"].concat(
    payload.laps.map(
      (lap, index) =>
        `${String(index + 1).padStart(2, "0")}-lap-${lap.lap_number}.sql`,
    ),
  ),
};
writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
console.log(`wrote ${outDir}`);
