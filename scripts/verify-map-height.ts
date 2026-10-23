/**
 * Map embed height contracts: session/compare maps must stay readable
 * (≥300px) at desktop and mobile viewports — never collapse under flex/min-h-0.
 */
import fs from "node:fs";
import path from "node:path";
import {
  MAP_EMBED_HEIGHT_CLASS,
  MAP_HEIGHT_MIN_PX,
  mapEmbedHeightPx,
} from "../src/lib/map-height";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// --- Viewport math (≥300px floor) ---
const desktop = mapEmbedHeightPx({ width: 1280, height: 800 });
const laptop = mapEmbedHeightPx({ width: 1440, height: 900 });
const iphone = mapEmbedHeightPx({ width: 390, height: 844 });
const iphoneLandscape = mapEmbedHeightPx({ width: 844, height: 390 });

assert(desktop >= MAP_HEIGHT_MIN_PX, `desktop map height ${desktop} < 300`);
assert(laptop >= MAP_HEIGHT_MIN_PX, `laptop map height ${laptop} < 300`);
assert(iphone >= MAP_HEIGHT_MIN_PX, `iPhone map height ${iphone} < 300`);
assert(
  iphoneLandscape >= MAP_HEIGHT_MIN_PX,
  `iPhone landscape map height ${iphoneLandscape} < 300`,
);

// Laptop band ~45–55vh → 50vh of 800 = 400
assert(desktop === 400, `desktop expected 50vh=400, got ${desktop}`);
// iPhone portrait: 55vw of 390 ≈ 214.5 → floored to 300
assert(iphone === 300, `iPhone expected min 300, got ${iphone}`);

// --- Source wiring ---
assert(
  MAP_EMBED_HEIGHT_CLASS.includes("min-h-[300px]"),
  "embed class has min-h-[300px]",
);
assert(
  MAP_EMBED_HEIGHT_CLASS.includes("55vw") &&
    MAP_EMBED_HEIGHT_CLASS.includes("sm:h-[50vh]"),
  "embed class uses ~55vw mobile / ~50vh desktop",
);

const leaflet = read("src/components/LeafletTrackMap.tsx");
const chase = read("src/components/ChaseTrackMap.tsx");
const trackMap = read("src/components/TrackMap.tsx");
const synced = read("src/components/video/SyncedLapView.tsx");
const compare = read("src/components/LapCompare.tsx");

assert(
  leaflet.includes("MAP_EMBED_HEIGHT_CLASS") &&
    /panel:\s*MAP_EMBED_HEIGHT_CLASS/.test(leaflet),
  "Leaflet panel uses shared embed height",
);
assert(
  chase.includes("MAP_EMBED_HEIGHT_CLASS") &&
    /panel:\s*MAP_EMBED_HEIGHT_CLASS/.test(chase),
  "Chase/POV panel uses shared embed height",
);
assert(
  /<TrackMap[\s\S]*?\bpanel\b/.test(compare),
  "compare map uses panel height",
);
assert(
  !leaflet.includes("min-h-0 flex-1"),
  "Leaflet panel map must not use min-h-0 flex-1 collapse",
);
assert(
  !chase.includes('panel: "h-full') && !chase.includes("min-h-0"),
  "Chase panel must not use h-full/min-h-0 collapse",
);
assert(
  leaflet.includes("ResizeObserver") && leaflet.includes("invalidateSize"),
  "Leaflet resizes on layout change",
);
assert(
  chase.includes("ResizeObserver") && chase.includes("map.resize"),
  "Chase calls map.resize on layout change",
);
assert(
  !trackMap.includes("h-full min-h-0 flex-col"),
  "TrackMap POV shell no longer relies on parent height",
);
assert(synced.includes("min-h-[300px]"), "session workspace map floor 300px");
assert(compare.includes("min-h-[300px]"), "compare map column floor 300px");
assert(
  synced.includes("panel={workspace}") && synced.includes("compact={workspace}"),
  "session workspace still uses panel+compact map",
);
assert(
  trackMap.includes("Overview") && trackMap.includes("POV"),
  "Overview|POV toggle still present",
);

// Page scroll — no nested overflow trap on session/compare shells
const session = read("src/components/CloudSessionView.tsx");
assert(
  session.includes("min-h-dvh") && !session.includes("overflow-hidden"),
  "session page scrolls naturally",
);

console.log(
  JSON.stringify({
    ok: true,
    heightClass: MAP_EMBED_HEIGHT_CLASS,
    viewports: {
      desktop1280x800: desktop,
      laptop1440x900: laptop,
      iphone390x844: iphone,
      iphoneLandscape844x390: iphoneLandscape,
    },
    minPx: MAP_HEIGHT_MIN_PX,
  }),
);
