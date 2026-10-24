/**
 * Default speed unit is mph; toggle persists; UI sites use formatSpeed / unit hook.
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SPEED_UNIT,
  formatSpeed,
  kmhToDisplay,
  parseSpeedUnit,
  speedUnitSuffix,
} from "../src/lib/speed-units";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(DEFAULT_SPEED_UNIT === "mph", "default unit is mph");
assert(parseSpeedUnit(null) === "mph", "null → mph");
assert(parseSpeedUnit("kmh") === "kmh", "kmh parses");
assert(parseSpeedUnit("nope") === "mph", "unknown → mph");

const sixty = kmhToDisplay(160.934, "mph");
assert(Math.abs(sixty - 100) < 0.01, `160.934 km/h → ~100 mph, got ${sixty}`);
assert(kmhToDisplay(100, "kmh") === 100, "kmh passthrough");
assert(formatSpeed(160.934, "mph") === "100 mph", formatSpeed(160.934, "mph"));
assert(formatSpeed(57, "kmh") === "57 km/h", formatSpeed(57, "kmh"));
assert(speedUnitSuffix("mph") === "mph", "mph suffix");
assert(speedUnitSuffix("kmh") === "km/h", "kmh suffix");

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const header = read("src/components/AppHeader.tsx");
assert(
  header.includes("SpeedUnitToggle"),
  "header hosts the single mph/km/h toggle",
);

const toggle = read("src/components/SpeedUnitToggle.tsx");
assert(toggle.includes("cursor-pointer"), "toggle has pointer cursor");
assert(toggle.includes("data-apex-speed-unit-toggle"), "toggle test id");

for (const [rel, needle] of [
  ["src/components/SpeedChart.tsx", "useSpeedUnit"],
  ["src/components/SessionLapDetail.tsx", "formatSpeed"],
  ["src/components/LeafletTrackMap.tsx", "formatSpeed"],
  ["src/components/video/SyncedLapView.tsx", "formatSpeed"],
  ["src/components/LapCompare.tsx", "speedUnitLabel"],
] as const) {
  const src = read(rel);
  assert(src.includes(needle), `${rel} uses ${needle}`);
  // No hard-coded km/h-only labels left in user-facing speed strings
  // (allow comments / parsers).
}

const speedChart = read("src/components/SpeedChart.tsx");
assert(
  !speedChart.includes('` km/h`') && !speedChart.includes('"km/h"'),
  "SpeedChart no longer hard-codes km/h-only labels",
);

console.log(
  JSON.stringify({
    ok: true,
    defaultUnit: DEFAULT_SPEED_UNIT,
    sample: formatSpeed(160.934, "mph"),
  }),
);
