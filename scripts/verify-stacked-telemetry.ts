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

// Channel detection: hide empties, keep speed + derived G.
const bare: TelemetryPoint[] = [
  { t: 0, speed: 100 },
  { t: 1, speed: 110 },
];
assert(
  detectLapChannels(bare).join(",") === "speed",
  `bare expected speed only, got ${detectLapChannels(bare)}`,
);

const enriched = enrichTelemetry(bare);
assert(
  detectLapChannels(enriched).includes("g"),
  "enriched speed series should expose G",
);
assert(
  !detectLapChannels(enriched).includes("throttleBrake"),
  "must hide throttle/brake when absent",
);

const withExtras: TelemetryPoint[] = [
  {
    t: 0,
    speed: 100,
    throttle: 40,
    brake: 0,
    steering: -5,
    rpm: 5000,
    gear: 3,
    heading: 90,
    latG: 0.2,
    lonG: -0.1,
  },
  {
    t: 1,
    speed: 105,
    throttle: 60,
    brake: 10,
    steering: 2,
    rpm: 5500,
    gear: 3,
    heading: 95,
    latG: 0.3,
    lonG: -0.2,
  },
];
const full = detectLapChannels(withExtras);
assert(full.includes("speed"), "speed");
assert(full.includes("throttleBrake"), "throttleBrake");
assert(full.includes("steering"), "steering");
assert(full.includes("g"), "g");
assert(full.includes("gearRpm"), "gearRpm");
assert(full.includes("heading"), "heading");
assert(!full.includes("delta"), "lap view has no delta");

const compareIds = detectCompareChannels([withExtras, bare], {
  includeDelta: true,
});
assert(compareIds.includes("delta"), "compare shows delta");
assert(compareIds.includes("throttleBrake"), "compare keeps optional if any lap has it");

// Parse STC fixture: Brake (calculated) + Heading.
const stcPath = path.join(root, "third_party/STC_log.csv");
if (fs.existsSync(stcPath)) {
  const parsed = parseTelemetryCsv(fs.readFileSync(stcPath, "utf8"));
  const lap = parsed.laps[0];
  assert(lap, "STC should yield a lap");
  assert(
    lap.points.some((p) => p.brake != null),
    "STC Brake (calculated) should populate brake",
  );
  assert(
    lap.points.some((p) => p.heading != null),
    "STC Heading should populate heading",
  );
  const channels = detectLapChannels(enrichTelemetry(lap.points));
  assert(channels.includes("throttleBrake"), "STC stack includes brake channel");
  assert(channels.includes("heading"), "STC stack includes heading");
}

// Optional channels flow into compareMany flat keys.
const a = withExtras;
const b = withExtras.map((p) => ({ ...p, t: p.t + 0.05, speed: p.speed - 2 }));
const series = compareMany(a, [b], 20);
assert(series.length >= 2, "compare series");
assert(typeof series[0].throttle0 === "number", "throttle0 on compare series");
assert(typeof series[0].throttle1 === "number", "throttle1 on compare series");
assert(typeof series[0].delta1 === "number", "delta1 present");

// UI wiring: stacked panel used; tabs gone from LapCompare.
const lapCompare = fs.readFileSync(
  path.join(root, "src/components/LapCompare.tsx"),
  "utf8",
);
// Compare stacked panel is exported; LapCompare tab migration may land separately.
const stackedSrc = fs.readFileSync(
  path.join(root, "src/components/StackedTelemetry.tsx"),
  "utf8",
);
assert(
  stackedSrc.includes("export function StackedCompareTelemetry"),
  "StackedCompareTelemetry must be exported",
);
assert(
  stackedSrc.includes("min-h-[160px]") || stackedSrc.includes("sm:min-h-[200px]"),
  "speed channel should keep a solid min height (no flex sliver)",
);
assert(stackedSrc.includes("overflow-y-auto"), "stack scrolls instead of squashing");
assert(stackedSrc.includes("fill"), "speed chart should fill its flex slot");

const gChartSrc = fs.readFileSync(
  path.join(root, "src/components/GChart.tsx"),
  "utf8",
);
assert(gChartSrc.includes("Lateral G"), "G chart stacks lateral");
assert(gChartSrc.includes("Longitudinal G"), "G chart stacks longitudinal");
assert(gChartSrc.includes("Friction circle"), "G chart includes friction circle");
assert(
  (gChartSrc.includes("sm:h-[120px]") || gChartSrc.includes("sm:min-h-[120px]")) &&
    !gChartSrc.includes("h-[56px]"),
  "G rows ~120px on desktop, no 56px slivers",
);

const lapCompareSrc = fs.readFileSync(
  path.join(root, "src/components/LapCompare.tsx"),
  "utf8",
);
assert(lapCompareSrc.includes("LapChipPicker"), "compare uses compact lap chips");
assert(lapCompareSrc.includes("defaultOpen"), "compare lap selection expanded by default");
assert(
  lapCompareSrc.includes("min-h-[120px]") || lapCompareSrc.includes("h-[120px]"),
  "compare ChartCard keeps ≥120px plot height",
);

const speedChartSrc = fs.readFileSync(
  path.join(root, "src/components/SpeedChart.tsx"),
  "utf8",
);
assert(
  speedChartSrc.includes("speedAxisDomain"),
  "speed chart auto-scales y domain",
);

// TrackAddict Accel X/Y → latG/lonG
const taPath = path.join(root, "src/lib/fixtures/trackaddict-snippet.csv");
const ta = parseTelemetryCsv(fs.readFileSync(taPath, "utf8"));
assert(
  ta.laps.some((lap) =>
    lap.points.some((p) => p.latG != null && p.lonG != null),
  ),
  "TrackAddict Accel columns should populate G",
);

// Thunderhill GoPro GPS fixture: derive G when ACCL absent.
const thPath = path.join(
  root,
  "src/lib/fixtures/gopro-thunderhill-west-session-gps.json",
);
if (fs.existsSync(thPath)) {
  const th = JSON.parse(fs.readFileSync(thPath, "utf8")) as {
    points: TelemetryPoint[];
  };
  const derived = enrichTelemetry(th.points.slice(200, 500));
  assert(detectLapChannels(derived).includes("g"), "Thunderhill derived G");
  const peakLon = Math.max(...derived.map((p) => Math.abs(p.lonG)));
  assert(peakLon > 0.05, `Thunderhill long G should move (peak ${peakLon})`);
}

const synced = fs.readFileSync(
  path.join(root, "src/components/video/SyncedLapView.tsx"),
  "utf8",
);
assert(
  synced.includes("StackedLapTelemetry"),
  "SyncedLapView must render StackedLapTelemetry",
);
assert(
  !synced.includes("SpeedChart") && !synced.includes("GChart"),
  "SyncedLapView must not use tabbed SpeedChart/GChart pair",
);

const lapCharts = fs.readFileSync(
  path.join(root, "src/components/LapCharts.tsx"),
  "utf8",
);
assert(
  lapCharts.includes("StackedLapTelemetry"),
  "LapCharts must stack channels",
);
assert(
  lapCharts.includes("lg:grid-cols-"),
  "LapCharts must keep side-by-side map/chart layout",
);

console.log(
  JSON.stringify({
    ok: true,
    lapChannels: full,
    compareChannels: compareIds,
    stc: fs.existsSync(stcPath),
  }),
);
