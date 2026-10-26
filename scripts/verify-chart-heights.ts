/**
 * Static + layout contracts: charts must not collapse under flex/min-h-0.
 */
import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const g = read("src/components/GChart.tsx");
assert(g.includes("Friction circle"), "friction circle present");
assert(g.includes("G_ROW_HEIGHT") || g.includes("sm:h-[120px]"), "G ~120px desktop");
assert(g.includes("minHeight={100}") || g.includes("min-h-[100px]"), "G minHeight floor");

const channel = read("src/components/ChannelChart.tsx");
assert(
  channel.includes("sm:h-[120px]") || channel.includes("min-h-[100px]"),
  "channel charts not slivers",
);

const stacked = read("src/components/StackedTelemetry.tsx");
assert(
  stacked.includes("min-h-[160px]") || stacked.includes("sm:min-h-[200px]"),
  "stacked speed keeps real min height",
);
assert(
  !stacked.includes("overflow-y-auto"),
  "stacked telemetry uses page scroll (no nested overflow pane)",
);
assert(
  !stacked.includes("basis-[40%]"),
  "removed flex-basis squashing that made sliver charts",
);

const compare = read("src/components/LapCompare.tsx");
assert(compare.includes("data-apex-compare-chart"), "compare charts tagged");
assert(compare.includes("min-h-[120px]"), "compare plot min 120px");
assert(compare.includes("minHeight={120}"), "ResponsiveContainer minHeight");
assert(
  compare.includes("Comparing (") || compare.includes("lapPicker"),
  "laps picker always visible",
);
assert(compare.includes("apex-pressable"), "shared pressable styles");
assert(
  compare.includes("Search sessions") ||
    compare.includes("Search laps") ||
    compare.includes("Track"),
  "session/track filter in picker",
);

const tools = read("src/components/SessionToolsPanel.tsx");
assert(tools.includes("showButtons"), "tools panel still available for extras");

console.log(JSON.stringify({ ok: true, chartHeights: "≥100/120px contracts" }));
