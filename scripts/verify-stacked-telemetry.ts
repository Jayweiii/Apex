import fs from "node:fs";
import path from "node:path";
import { compareMany } from "../src/lib/compare";
import { enrichTelemetry } from "../src/lib/gforce";
import { parseTelemetryCsv } from "../src/lib/parse-telemetry";
import {
  detectCompareChannels,
  detectLapChannels,
} from "../src/lib/telemetry-channels";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");

const bare: TelemetryPoint[] = [
  { t: 0, speed: 100 },
  { t: 1, speed: 110 },
];
assert(detectLapChannels(bare).join(",") === "speed", `bare got ${detectLapChannels(bare)}`);
const enriched = enrichTelemetry(bare);
assert(detectLapChannels(enriched).includes("g"), "enriched should expose G");
assert(!detectLapChannels(enriched).includes("throttleBrake"), "hide empty throttle");

const withExtras: TelemetryPoint[] = [
  { t: 0, speed: 100, throttle: 40, brake: 0, steering: -5, rpm: 5000, gear: 3, heading: 90, latG: 0.2, lonG: -0.1 },
  { t: 1, speed: 105, throttle: 60, brake: 10, steering: 2, rpm: 5500, gear: 3, heading: 95, latG: 0.3, lonG: -0.2 },
];
const full = detectLapChannels(withExtras);
for (const id of ["speed", "throttleBrake", "steering", "g", "gearRpm", "heading"] as const) {
  assert(full.includes(id), id);
}
assert(!full.includes("delta"), "no delta on lap");

const compareIds = detectCompareChannels([withExtras, bare], { includeDelta: true });
assert(compareIds.includes("delta"), "compare delta");
assert(compareIds.includes("throttleBrake"), "compare optional");

const stcPath = path.join(root, "third_party/STC_log.csv");
if (fs.existsSync(stcPath)) {
  const parsed = parseTelemetryCsv(fs.readFileSync(stcPath, "utf8"));
  const lap = parsed.laps[0];
  assert(lap, "STC lap");
  assert(lap.points.some((p) => p.brake != null), "STC brake");
  assert(lap.points.some((p) => p.heading != null), "STC heading");
  const channels = detectLapChannels(enrichTelemetry(lap.points));
  assert(channels.includes("throttleBrake"), "STC throttleBrake channel");
  assert(channels.includes("heading"), "STC heading channel");
}

const a = withExtras;
const b = withExtras.map((p) => ({ ...p, t: p.t + 0.05, speed: p.speed - 2 }));
const series = compareMany(a, [b], 20);
assert(series.length >= 2, "series");
assert(typeof series[0].throttle0 === "number", "throttle0");
assert(typeof series[0].throttle1 === "number", "throttle1");
assert(typeof series[0].delta1 === "number", "delta1");

const lapCompare = fs.readFileSync(path.join(root, "src/components/LapCompare.tsx"), "utf8");
assert(lapCompare.includes("StackedCompareTelemetry"), "LapCompare stack");
assert(!lapCompare.includes("chartPanel"), "no chartPanel");
assert(!/setChartPanel/.test(lapCompare), "no setChartPanel");

const synced = fs.readFileSync(path.join(root, "src/components/video/SyncedLapView.tsx"), "utf8");
assert(synced.includes("StackedLapTelemetry"), "SyncedLapView stack");
assert(!/import \{[^}]*SpeedChart/.test(synced) && !/import \{[^}]*GChart/.test(synced), "no chart tab imports");
assert(synced.includes("lg:grid-cols-"), "side-by-side");

const lapCharts = fs.readFileSync(path.join(root, "src/components/LapCharts.tsx"), "utf8");
assert(lapCharts.includes("StackedLapTelemetry"), "LapCharts stack");
assert(lapCharts.includes("lg:grid-cols-"), "LapCharts side-by-side");

console.log(JSON.stringify({ ok: true, lapChannels: full, compareChannels: compareIds, stc: fs.existsSync(stcPath) }));
