/**
 * Static + layout contracts: charts must not collapse under flex/min-h-0.
 * Cartesian plot areas must stay ≥200px (container absorbs axis chrome).
 */
import fs from "node:fs";
import path from "node:path";
import {
  CHANNEL_CHART_MIN_HEIGHT,
  COMPARE_CHART_MIN_HEIGHT,
  G_CHART_ROW_MIN_HEIGHT,
  MIN_PLOT_AREA_PX,
  STACKED_SPEED_MIN_HEIGHT,
} from "../src/lib/chart-height-contract";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

assert(MIN_PLOT_AREA_PX >= 200, "plot area floor ≥200");
assert(STACKED_SPEED_MIN_HEIGHT >= 260, "stacked speed container ≥260");
assert(CHANNEL_CHART_MIN_HEIGHT >= 240, "channel container ≥240");
assert(G_CHART_ROW_MIN_HEIGHT >= 240, "G row container ≥240");
assert(COMPARE_CHART_MIN_HEIGHT >= 300, "compare container ≥300");

const g = read("src/components/GChart.tsx");
assert(g.includes("Friction circle"), "friction circle present");
assert(
  g.includes("h-[240px]") || g.includes("min-h-[240px]"),
  "G row ≥240px so plot ≥200px",
);
assert(
  g.includes("minHeight={220}") || g.includes("min-h-[240px]"),
  "G minHeight floor",
);

const channel = read("src/components/ChannelChart.tsx");
assert(
  channel.includes("h-[240px]") || channel.includes("min-h-[240px]"),
  "channel charts ≥240px container",
);

const stacked = read("src/components/StackedTelemetry.tsx");
assert(
  stacked.includes("min-h-[280px]") || stacked.includes("h-[280px]"),
  "stacked speed keeps real min height ≥280",
);
assert(
  !stacked.includes("overflow-y-auto"),
  "stacked telemetry uses page scroll (no nested overflow pane)",
);
assert(
  !stacked.includes("basis-[40%]"),
  "removed flex-basis squashing that made sliver charts",
);

const speed = read("src/components/SpeedChart.tsx");
assert(
  speed.includes("h-[280px]") || speed.includes("min-h-[280px]"),
  "speed fill shell ≥280px",
);

const compare = read("src/components/LapCompare.tsx");
assert(compare.includes("data-apex-compare-chart"), "compare charts tagged");
assert(
  compare.includes("min-h-[320px]") ||
    compare.includes("h-[320px]") ||
    compare.includes("min-h-[300px]") ||
    compare.includes("h-[300px]"),
  "compare plot container ≥300px so cartesian plot ≥200px after legend/axes",
);
assert(
  compare.includes("minHeight={300}") ||
    compare.includes("minHeight={280}") ||
    compare.includes('height="100%"') ||
    compare.includes("height={320}") ||
    compare.includes("height={300}"),
  "ResponsiveContainer fills plot container",
);
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

console.log(
  JSON.stringify({
    ok: true,
    chartHeights: "≥200px plot / ≥240–320px containers",
    floors: {
      MIN_PLOT_AREA_PX,
      STACKED_SPEED_MIN_HEIGHT,
      CHANNEL_CHART_MIN_HEIGHT,
      G_CHART_ROW_MIN_HEIGHT,
      COMPARE_CHART_MIN_HEIGHT,
    },
  }),
);
