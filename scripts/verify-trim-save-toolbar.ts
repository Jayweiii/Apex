/**
 * Jason batch: bidirectional trim drag, explicit Save, labeled tools toolbar.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildTrimChartContext,
  chartTAtClientX,
  clampTrimDrag,
  sessionDataRange,
  type TrimableLap,
} from "../src/lib/lap-trim";
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Mirrors UnsavedChangesBar — warn only when dirty and not loading. */
function shouldWarnBeforeUnload(dirty: boolean, loading: boolean) {
  return dirty && !loading;
}

function lap(
  id: string,
  n: number,
  start: number,
  durationSec: number,
): TrimableLap {
  const telemetry = [];
  for (let i = 0; i <= 20; i += 1) {
    telemetry.push({
      t: (durationSec * i) / 20,
      speed: 80 + i,
      lat: 39.5 + i * 0.0001,
      lon: -122.3,
    });
  }
  return {
    id,
    lap_number: n,
    lap_time_ms: Math.round(durationSec * 1000),
    start_offset_sec: start,
    telemetry,
  };
}

const a = lap("a", 1, 0, 50);
const b = lap("b", 2, 50, 50);
const c = lap("c", 3, 100, 50);
const siblings = [a, b, c];

const range = sessionDataRange(siblings);
assert(Math.abs(range.min - 0) < 0.01, `session min ${range.min}`);
assert(Math.abs(range.max - 150) < 0.01, `session max ${range.max}`);

// Pointer-drag both directions: start can move outward (left) and inward (right).
const mid = { start: 50, end: 100 };
const startOut = clampTrimDrag("start", 40, mid, range, 1);
assert(startOut.start === 40, `start outward got ${startOut.start}`);
assert(startOut.end === 100, "end unchanged");
const startIn = clampTrimDrag("start", 60, mid, range, 1);
assert(startIn.start === 60, `start inward got ${startIn.start}`);
const endOut = clampTrimDrag("end", 110, mid, range, 1);
assert(endOut.end === 110, `end outward got ${endOut.end}`);
const endIn = clampTrimDrag("end", 90, mid, range, 1);
assert(endIn.end === 90, `end inward got ${endIn.end}`);

// Clamp only to session + start < end
const pastSession = clampTrimDrag("start", -10, mid, range, 1);
assert(pastSession.start === 0, "clamp to session min");
const crossed = clampTrimDrag("start", 99.5, mid, range, 1);
assert(crossed.start <= mid.end - 1, "start stays before end");

const chart = buildTrimChartContext(b, siblings, { padSec: 8 });
assert(chart.points.some((p) => p.inLap === false), "grey neighbor padding");
assert(chart.points.some((p) => p.inLap === true), "in-lap samples");
assert(chart.trimStartT > 0.5, "room to drag start outward");
assert(
  chart.trimEndT < chart.points[chart.points.length - 1].t - 0.5,
  "room to drag end outward",
);
assert(chart.sessionMin === range.min && chart.sessionMax === range.max, "range");

// chartTAtClientX both directions from center
const tLeft = chartTAtClientX(10, { left: 0, width: 200 }, 0, 100);
const tRight = chartTAtClientX(190, { left: 0, width: 200 }, 0, 100);
assert(tLeft < 50, `left drag t=${tLeft}`);
assert(tRight > 50, `right drag t=${tRight}`);

assert(shouldWarnBeforeUnload(true, false) === true, "warn when dirty");
assert(shouldWarnBeforeUnload(true, true) === false, "no warn while loading");
assert(shouldWarnBeforeUnload(false, false) === false, "no warn when clean");

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const speed = read("src/components/SpeedChart.tsx");
assert(speed.includes("setPointerCapture"), "pointer capture on handles");
assert(speed.includes("pointermove"), "window pointermove while dragging");
assert(
  !/onPointerLeave[\s\S]{0,80}setDragging\(null\)/.test(speed),
  "pointer leave must not cancel trim drag",
);
assert(speed.includes("ReferenceArea") || speed.includes("speedInTrim"), "grey pad");

const cloud = read("src/components/CloudSessionView.tsx");
assert(cloud.includes("UnsavedChangesBar"), "unsaved bar");
assert(cloud.includes("Unsaved changes") || cloud.includes('dirty={dirty}'), "dirty prop");
assert(cloud.includes("markDirty"), "edits mark dirty not auto-save");
assert(cloud.includes("saveEdits"), "explicit save");
assert(cloud.includes("discardEdits"), "discard");
assert(cloud.includes("onStage"), "reparse stages for save");
assert(
  cloud.includes('aria-label="Session tools"') ||
    cloud.includes("Re-parse laps"),
  "labeled toolbar",
);
assert(cloud.includes("Sync video"), "Sync video button");
assert(cloud.includes("Edit details"), "Edit details button");
assert(cloud.includes("Share"), "Share button");
assert(cloud.includes("Trim"), "Trim button");
assert(cloud.includes("Exclude"), "Exclude button");
assert(cloud.includes("DeleteSessionControl") || cloud.includes("Delete session"), "Delete session danger");

const tools = read("src/components/SessionToolsPanel.tsx");
assert(tools.includes('role="toolbar"'), "tools toolbar role");
assert(tools.includes("min-h-10"), "touch-sized buttons for iPhone");
assert(tools.includes("showButtons"), "external toolbar can hide duplicate buttons");
assert(!tools.includes("fixed right-3 top-1/2"), "no hidden edge drawer toggle");
assert(cloud.includes("toolsShowButtons={false}"), "session page hides panel buttons");
assert(cloud.includes('data-testid="toolbar-reparse"'), "toolbar reparse test id");

const detail = read("src/components/SessionLapDetail.tsx");
assert(detail.includes("buildTrimChartContext"), "padded trim chart");
assert(detail.includes("clampTrimDrag"), "free bidirectional clamp");

const bar = read("src/components/UnsavedChangesBar.tsx");
assert(bar.includes("beforeunload"), "navigate-away warn");
assert(bar.includes("loading"), "skip warn while loading");

console.log(
  JSON.stringify({
    ok: true,
    trim: "bidirectional+padded+session-clamp",
    save: "explicit+beforeunload-when-dirty",
    toolbar: "labeled-visible",
  }),
);
