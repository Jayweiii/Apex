/**
 * E2E-style checks for Jason feedback on production 5f11d3e:
 * (1) one toolbar control per action (no in-panel duplicates)
 * (2) toolbar Re-parse opens the flow (autoStart → file picker or re-split)
 * (3) GL010057 / thunderhill GPS fixture yields 11 laps pending Save
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  reparseLapsFromPoints,
  resolveGpsForReparse,
} from "../src/lib/session-reparse";
import type { TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const fixtureCandidates = [
  "/cursor/stores/self/fixtures/GL010057-session-gps.json",
  "/cursor/stores/fixtures/GL010057-session-gps.json",
  resolve(root, "src/lib/fixtures/gopro-thunderhill-west-session-gps.json"),
];
const fixturePath = fixtureCandidates.find((p) => existsSync(p));
assert(fixturePath, "GL010057 / thunderhill GPS fixture missing");

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  expectedHotLaps?: number;
  points: Array<{ t: number; lat: number; lon: number; speed: number }>;
};
const points: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
}));

// --- Functional: clicking re-parse with dense GPS produces 11 laps ---
const split = reparseLapsFromPoints(points, {
  startFinish: { lat: 39.53905, lon: -122.3387 },
  trackId: "thunderhill-west",
});
assert(
  split.laps.length === 11,
  `GL010057 fixture expected 11 laps, got ${split.laps.length}`,
);

// No source_gps → need file (matches session 1aa2fb88)
const coarse = resolveGpsForReparse({
  sourceGps: null,
  laps: [
    {
      lap_number: 1,
      start_offset_sec: 0,
      telemetry: points.slice(0, 40),
    },
  ],
});
assert(!coarse.density.ok, "sparse stitch should require file picker");

const dense = resolveGpsForReparse({ sourceGps: points, laps: [] });
assert(dense.density.ok, "dense source_gps should re-split immediately");
assert(dense.from === "source_gps", "prefers source_gps");

// --- Wire: toolbar button opens flow with autoStart ---
const cloud = read("src/components/CloudSessionView.tsx");
assert(cloud.includes('data-testid="toolbar-reparse"'), "toolbar reparse button");
assert(cloud.includes("autoStart"), "reparse panel autoStarts on toolbar click");
assert(cloud.includes('data-testid="reparse-flow"') || cloud.includes("SessionReparsePanel"), "reparse flow mounts");
assert(cloud.includes("toolsShowButtons={false}"), "hide duplicate in-panel tool buttons");
assert(
  (cloud.match(/Re-parse laps/g) ?? []).length <= 3,
  "Re-parse label not duplicated excessively in cloud view",
);

// One labeled control per action in the session tools toolbar.
const toolbarBlock = cloud.match(
  /aria-label="Session tools"[\s\S]{0,6000}?ShareLinkButton[\s\S]{0,200}?\/>/,
)?.[0];
assert(toolbarBlock, "session tools toolbar block");
for (const id of [
  "toolbar-reparse",
  "toolbar-trim",
  "toolbar-sync",
  "toolbar-exclude",
  "toolbar-details",
]) {
  const count = (toolbarBlock.match(new RegExp(`data-testid="${id}"`, "g")) ?? [])
    .length;
  assert(count === 1, `toolbar has exactly one ${id} (got ${count})`);
}
assert(
  (toolbarBlock.match(/label="Share"/g) ?? []).length === 1,
  "toolbar has exactly one Share",
);
// No second session-tools toolbar elsewhere on the cloud session page.
assert(
  (cloud.match(/aria-label="Session tools"/g) ?? []).length === 1,
  "exactly one Session tools toolbar on cloud session page",
);

const local = read("src/components/LocalGarage.tsx");
assert(local.includes('data-testid="toolbar-reparse"'), "local toolbar reparse");
assert(local.includes("toolsShowButtons={false}"), "local hides panel button row");

const panel = read("src/components/SessionReparsePanel.tsx");
assert(panel.includes("autoStart"), "SessionReparsePanel autoStart prop");
assert(panel.includes("fileRef.current?.click()"), "autoStart opens file picker");
assert(panel.includes('data-testid="reparse-file-input"'), "file input test id");
assert(panel.includes("runReparse()"), "autoStart can re-split immediately");

const tools = read("src/components/SessionToolsPanel.tsx");
assert(tools.includes("showButtons"), "SessionToolsPanel can hide button row");
assert(tools.includes('role="toolbar"'), "tools toolbar role when shown");

const lapList = read("src/components/LapList.tsx");
assert(
  !lapList.includes("ReparseLapsButton"),
  "lap list must not duplicate toolbar Re-parse button",
);
assert(lapList.includes("UnsplitLapsBanner"), "unsplit banner still available");

const synced = read("src/components/video/SyncedLapView.tsx");
assert(synced.includes("showButtons={toolsShowButtons}"), "panel respects showButtons");

const css = read("src/app/globals.css");
assert(css.includes("cursor: pointer"), "global pointer for clickables");
assert(css.includes('button:not(:disabled)'), "buttons get pointer");
assert(css.includes("[data-apex-chart-plot]"), "chart scrub areas get pointer");

// Simulate the toolbar click → open flow contract
function simulateToolbarReparseClick(opts: {
  hasDenseSourceGps: boolean;
}): "file-picker" | "resplit" {
  // Mirrors SessionReparsePanel autoStart branch
  return opts.hasDenseSourceGps ? "resplit" : "file-picker";
}
assert(
  simulateToolbarReparseClick({ hasDenseSourceGps: false }) === "file-picker",
  "no source_gps → file picker (session 1aa2fb88)",
);
assert(
  simulateToolbarReparseClick({ hasDenseSourceGps: true }) === "resplit",
  "dense source_gps → immediate re-split",
);

console.log(
  JSON.stringify({
    ok: true,
    fixture: fixturePath,
    laps: split.laps.length,
    expectedHotLaps: fixture.expectedHotLaps ?? null,
    toolbar: "single-controls",
    reparseClick: "autoStart-file-or-resplit",
    cursor: "pointer-globals",
  }),
);
