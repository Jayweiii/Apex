/**
 * Static contract: iPhone first-tap + UI_RULES control patterns.
 * - Tailwind hover remapped via nested @custom-variant (media → &:hover → @slot)
 * - Shared apex-* hover behind (hover:hover) and (pointer:fine)
 * - touch-action: manipulation on clickables
 * - No layout-shifting transforms on :hover (scale / translate stay on :active)
 * - Segmented modes, disclosure expanders, 44pt tap token, docs wired for Muse
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const css = read("src/app/globals.css");

assert(css.includes("@custom-variant hover"), "custom hover variant");
assert(
  css.includes("@media (hover: hover) and (pointer: fine)"),
  "fine-pointer hover media",
);
assert(
  /@custom-variant hover\s*\{[\s\S]*?@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?&:hover[\s\S]*?@slot/.test(
    css,
  ),
  "custom-variant nests media → &:hover → @slot (not @media …:hover shorthand)",
);
assert(
  !/@custom-variant hover\s*\(\s*@media \(hover: hover\) and \(pointer: fine\):hover\s*\)/.test(
    css,
  ),
  "no broken shorthand that emits invalid @media …:hover",
);

assert(css.includes("touch-action: manipulation"), "touch-action on clickables");
assert(
  /button:not\(:disabled\)[\s\S]*touch-action:\s*manipulation/.test(css),
  "buttons get touch-action:manipulation",
);
assert(css.includes(".apex-btn:active"), "pressed/active styles kept");
assert(css.includes(".apex-nav-link:active"), "nav pressed styles kept");

assert(
  /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*a\.apex-eyebrow:hover/.test(
    css,
  ),
  "eyebrow hover gated by fine pointer",
);

const hoverBlocks = [
  ...css.matchAll(
    /@media \(hover: hover\) and \(pointer: fine\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
  ),
];
assert(hoverBlocks.length >= 8, "expected multiple gated hover blocks");
for (const [, body] of hoverBlocks) {
  assert(
    !/transform\s*:\s*[^;]*(scale|translate)/.test(body),
    "no transform scale/translate inside hover media (layout shift)",
  );
}

assert(css.includes("--apex-tap-min"), "44pt tap token");
assert(css.includes(".apex-segment"), "segmented control styles");
assert(css.includes(".apex-disclosure"), "disclosure styles");
assert(css.includes("aria-expanded"), "disclosure expanded chevron rule");

assert(existsSync(resolve(root, "docs/UI_RULES.md")), "docs/UI_RULES.md");
const agents = read("AGENTS.md");
const contributing = read("CONTRIBUTING.md");
assert(agents.includes("docs/UI_RULES.md"), "AGENTS.md references UI_RULES");
assert(
  contributing.includes("docs/UI_RULES.md"),
  "CONTRIBUTING.md references UI_RULES",
);

const speed = read("src/components/SpeedUnitToggle.tsx");
assert(speed.includes("SegmentedControl"), "mph/kmh is segmented");
assert(speed.includes("data-apex-speed-unit-toggle"), "speed unit test id");

const basemap = read("src/components/BasemapToggle.tsx");
assert(basemap.includes("SegmentedControl"), "Street/Satellite segmented");

const trackMap = read("src/components/TrackMap.tsx");
assert(trackMap.includes("SegmentedControl"), "Overview/POV segmented");
assert(
  trackMap.includes("data-apex-map-chrome-basemap") &&
    trackMap.includes("data-apex-map-chrome-pov"),
  "POV chrome keeps basemap on its own reserved row (not beside Delta/POV)",
);
assert(
  css.includes("scrollbar-gutter: stable"),
  "html reserves scrollbar gutter (no map-chrome shift)",
);
assert(
  css.includes(".apex-map-chrome__basemap") &&
    css.includes("min-height: var(--apex-tap-min)"),
  "basemap row reserves tap-min height",
);

const leafletMap = read("src/components/LeafletTrackMap.tsx");
assert(
  leafletMap.includes("data-apex-map-chrome-basemap") &&
    leafletMap.includes("data-apex-map-chrome-modes"),
  "overview map keeps Basemap off the Delta/modes wrap row",
);

const uiRules = read("docs/UI_RULES.md");
assert(
  uiRules.includes("scrollbar-gutter") && uiRules.includes("Basemap"),
  "UI_RULES documents stable map chrome / scrollbar-gutter",
);

const chase = read("src/components/ChaseTrackMap.tsx");
assert(
  chase.includes("appliedBasemapRef.current = initialBasemap"),
  "POV basemap ref tracks the style baked at map create",
);
assert(
  !/if \(appliedBasemapRef\.current == null\) \{\s*appliedBasemapRef\.current = basemap;\s*return;/.test(
    chase,
  ),
  "POV must not ack basemap changes without applyBasemapTiles",
);
assert(
  !/if \(map\.isStyleLoaded\(\)\) swap\(\);\s*else map\.once\("load", swap\);/.test(
    chase,
  ),
  "POV Street swap must not gate on isStyleLoaded+once(load) after sat failover",
);
assert(
  chase.includes("apexBasemapStreetOpacity") &&
    chase.includes("apexBasemapSatOpacity"),
  "POV publishes raster-opacity for Street↔Satellite e2e",
);
assert(
  chase.includes('map.on("idle", onReady)') ||
    chase.includes("map.on('idle', onReady)"),
  "POV retries basemap swap on idle when layers not ready",
);

const header = read("src/components/AppHeader.tsx");
assert(header.includes("data-apex-nav-utils"), "mph toggle outside nav links");

const session = read("src/components/CloudSessionView.tsx");
assert(
  session.includes("data-apex-session-chrome"),
  "session chrome marked for mobile fold compaction",
);

const synced = read("src/components/video/SyncedLapView.tsx");
assert(synced.includes("aria-expanded={syncOpen}"), "sync disclosure expanded");
assert(synced.includes("apex-disclosure"), "sync uses disclosure style");
assert(synced.includes("apex-disclosure__chevron"), "sync chevron");

const playback = read("src/components/PlaybackControls.tsx");
assert(
  playback.includes("var(--apex-tap-min)") || playback.includes("apex-btn--cta"),
  "play control meets tap min",
);

console.log(
  JSON.stringify({
    ok: true,
    hoverVariant: "nested media+&:hover+@slot",
    touchAction: "manipulation",
    layoutShiftOnHover: false,
    activeStyles: true,
    uiRules: true,
    segmented: true,
    disclosure: true,
  }),
);
