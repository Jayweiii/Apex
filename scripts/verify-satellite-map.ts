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
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

assert(pkg.dependencies?.leaflet, "leaflet dependency");
assert(trackMap.includes('ssr: false'), "TrackMap dynamic import disables SSR");
assert(trackMap.includes("LeafletTrackMap") || trackMap.includes("leaflet"), "dynamic Leaflet");
assert(leaflet.includes("World_Imagery"), "Esri World Imagery tiles");
assert(leaflet.includes("openstreetmap.org"), "OSM street basemap");
assert(/Esri/i.test(leaflet), "Esri attribution");
assert(leaflet.includes("satellite") && leaflet.includes("street"), "basemap toggle");
assert(leaflet.includes("colorBySpeed") || leaflet.includes("speedColor"), "speed coloring");

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
    ssr: false,
  }),
);
