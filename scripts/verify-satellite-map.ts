/**
 * Smoke checks for satellite track map wiring (no browser / Leaflet DOM).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const trackMap = readFileSync(resolve(root, "src/components/TrackMap.tsx"), "utf8");
const leaflet = readFileSync(
  resolve(root, "src/components/LeafletTrackMap.tsx"),
  "utf8",
);
const chase = readFileSync(
  resolve(root, "src/components/ChaseTrackMap.tsx"),
  "utf8",
);
const toggle = readFileSync(
  resolve(root, "src/components/BasemapToggle.tsx"),
  "utf8",
);
const prefs = readFileSync(resolve(root, "src/lib/basemap-prefs.ts"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

assert(pkg.dependencies?.leaflet, "leaflet dependency");
assert(trackMap.includes('ssr: false'), "TrackMap dynamic import disables SSR");
assert(trackMap.includes("LeafletTrackMap") || trackMap.includes("leaflet"), "dynamic Leaflet");
assert(prefs.includes("World_Imagery"), "Esri World Imagery tiles");
assert(prefs.includes("openstreetmap.org"), "OSM street basemap");
assert(/Esri/i.test(prefs), "Esri attribution");
assert(toggle.includes("Street") && toggle.includes("Satellite"), "basemap toggle labels");
assert(toggle.includes("cursor-pointer"), "basemap toggle pointer cursor");
assert(trackMap.includes("BasemapToggle") && trackMap.includes("basemapControl"), "POV shows basemap");
assert(chase.includes("applyBasemapTiles"), "POV swaps tiles without setStyle");
assert(
  !/\.setStyle\s*\(/.test(chase),
  "POV must not call map.setStyle (preserves camera)",
);
assert(leaflet.includes("BasemapToggle"), "overview/SF uses shared toggle");
assert(leaflet.includes("colorBySpeed") || leaflet.includes("speedColor"), "speed coloring");
assert(leaflet.includes("dragging: false"), "map pan disabled");
assert(leaflet.includes("scrollWheelZoom: false"), "scroll zoom disabled");
assert(leaflet.includes("touchZoom: false"), "touch zoom disabled");
assert(leaflet.includes("doubleClickZoom: false"), "dblclick zoom disabled");
assert(leaflet.includes("zoomControl: false"), "zoom control hidden");
assert(leaflet.includes("65vh") || leaflet.includes("h-[65vh]"), "tall hero map");
assert(leaflet.includes("divIcon") || leaflet.includes("apex-car-marker"), "HTML car markers");
assert(leaflet.includes("apex-car-marker__dot--ring") || leaflet.includes('"ring"'), "ring vs filled markers");
assert(leaflet.includes("separateScrubPositions"), "overlap separation");
assert(leaflet.includes("gapLabelIcon") || leaflet.includes("apex-car-marker__gap"), "gap label");
assert(leaflet.includes("mousemove"), "map hover preview on move");
assert(
  leaflet.includes("onPreviewProgress") || leaflet.includes("previewProgress"),
  "map hover is preview-only (no seek)",
);

const globals = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
assert(
  globals.includes(".leaflet-container") && globals.includes("max-width: none"),
  "leaflet svg/img max-width override",
);
assert(globals.includes("apex-car-marker__dot--ring"), "ring marker CSS");
assert(/width:\s*9px/.test(globals), "compact filled marker ~9px");

const directory = readFileSync(
  resolve(root, "src/components/TrackDirectory.tsx"),
  "utf8",
);
assert(directory.includes("TrackOverviewMap") || directory.includes("TrackMap"), "track page map");

console.log(
  JSON.stringify({
    ok: true,
    leaflet: pkg.dependencies?.leaflet,
    basemaps: ["satellite:esri-world-imagery", "street:osm"],
    sharedToggle: true,
    povBasemap: true,
    ssr: false,
    fixedMap: true,
    carMarkers: "divIcon-compact-ring-filled",
  }),
);
