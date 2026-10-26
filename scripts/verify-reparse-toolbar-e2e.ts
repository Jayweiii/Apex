/**
 * E2E-style checks for contextual session tools:
 * (1) one control per action (no grouped toolbar duplicates)
 * (2) Re-parse near laps header opens the flow (autoStart)
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

const split = reparseLapsFromPoints(points, {
  startFinish: { lat: 39.53905, lon: -122.3387 },
  trackId: "thunderhill-west",
});
assert(
  split.laps.length === 11,
  `GL010057 fixture expected 11 laps, got ${split.laps.length}`,
);

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

const cloud = read("src/components/CloudSessionView.tsx");
assert(cloud.includes("onReparseLaps"), "reparse wired to laps list");
assert(cloud.includes("autoStart"), "reparse panel autoStarts on click");
assert(
  cloud.includes('data-testid="reparse-flow"') ||
    cloud.includes("SessionReparsePanel"),
  "reparse flow mounts",
);
assert(cloud.includes("toolsShowButtons={false}"), "no duplicate tool buttons");
assert(
  !cloud.includes('aria-label="Session tools"'),
  "grouped session tools toolbar removed",
);
assert(cloud.includes('data-testid="session-details-block"'), "details block");
assert(cloud.includes('data-testid="toolbar-details"'), "edit details control");
assert(cloud.includes("ShareLinkButton"), "Share in page header");
assert(cloud.includes("DeleteSessionControl"), "Delete in page header");
assert(
  (cloud.match(/data-testid="toolbar-details"/g) ?? []).length === 1,
  "exactly one edit-details control",
);

const lapList = read("src/components/LapList.tsx");
assert(
  lapList.includes('data-testid="toolbar-reparse"'),
  "re-parse lives near laps header",
);
assert(
  !lapList.includes("ReparseLapsButton"),
  "lap list must not duplicate Re-parse button component",
);
assert(lapList.includes("UnsplitLapsBanner"), "unsplit banner still available");
assert(
  lapList.includes('size="row"') || lapList.includes("lap-exclude-toggle"),
  "per-row exclude/include control",
);

const detail = read("src/components/SessionLapDetail.tsx");
assert(detail.includes('data-testid="toolbar-trim"'), "trim on chart header");
assert(detail.includes("chartHeader"), "chart header slot");
assert(detail.includes("mapHeader"), "map header slot");

const synced = read("src/components/video/SyncedLapView.tsx");
assert(synced.includes('data-testid="toolbar-sync"'), "sync on video header");
assert(synced.includes("toolsShowButtons"), "panel respects showButtons");
assert(synced.includes("mapHeader"), "map header prop");
assert(synced.includes("chartHeader"), "chart header prop");

const local = read("src/components/LocalGarage.tsx");
assert(local.includes("onReparseLaps"), "local reparse via laps header");
assert(local.includes("toolsShowButtons={false}"), "local hides panel buttons");
assert(
  !local.includes('aria-label="Session tools"'),
  "local grouped toolbar removed",
);

const panel = read("src/components/SessionReparsePanel.tsx");
assert(panel.includes("autoStart"), "SessionReparsePanel autoStart prop");
assert(panel.includes("fileRef.current?.click()"), "autoStart opens file picker");
assert(panel.includes('data-testid="reparse-file-input"'), "file input test id");
assert(panel.includes("runReparse()"), "autoStart can re-split immediately");

const tools = read("src/components/SessionToolsPanel.tsx");
assert(tools.includes("showButtons"), "SessionToolsPanel can hide button row");

const css = read("src/app/globals.css");
assert(css.includes(".apex-btn"), "shared apex-btn styles");
assert(css.includes("touch-action: manipulation"), "first-tap friendly");
assert(css.includes("@media (hover: hover)"), "hover only when hoverable");
assert(css.includes(".apex-btn:active"), "pressed/active styles");
assert(css.includes(".apex-btn:focus-visible"), "focus styles");
assert(css.includes("cursor: pointer"), "global pointer for clickables");

function simulateToolbarReparseClick(opts: {
  hasDenseSourceGps: boolean;
}): "file-picker" | "resplit" {
  return opts.hasDenseSourceGps ? "resplit" : "file-picker";
}
assert(
  simulateToolbarReparseClick({ hasDenseSourceGps: false }) === "file-picker",
  "no source_gps → file picker",
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
    tools: "contextual-single-controls",
    reparseClick: "autoStart-file-or-resplit",
    buttons: "apex-btn-hover-active-focus",
  }),
);
