/**
 * Map embed height contracts: session/compare maps must stay readable
 * (mobile ~360–400px, desktop ~550–600px) — never collapse under flex/min-h-0.
 */
import fs from "node:fs";
import path from "node:path";
import {
  MAP_EMBED_HEIGHT_CLASS,
  MAP_HEIGHT_DESKTOP_MAX_PX,
  MAP_HEIGHT_DESKTOP_MIN_PX,
  MAP_HEIGHT_MIN_PX,
  mapEmbedHeightPx,
} from "../src/lib/map-height";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// --- Viewport math ---
const desktop = mapEmbedHeightPx({ width: 1280, height: 800 });
const laptop = mapEmbedHeightPx({ width: 1440, height: 900 });
const iphone = mapEmbedHeightPx({ width: 390, height: 844 });
const iphoneLandscape = mapEmbedHeightPx({ width: 844, height: 390 });

assert(desktop >= MAP_HEIGHT_MIN_PX, `desktop map height ${desktop} < ${MAP_HEIGHT_MIN_PX}`);
assert(laptop >= MAP_HEIGHT_MIN_PX, `laptop map height ${laptop} < ${MAP_HEIGHT_MIN_PX}`);
assert(iphone >= MAP_HEIGHT_MIN_PX, `iPhone map height ${iphone} < ${MAP_HEIGHT_MIN_PX}`);
assert(
  iphoneLandscape >= MAP_HEIGHT_MIN_PX,
  `iPhone landscape map height ${iphoneLandscape} < ${MAP_HEIGHT_MIN_PX}`,
);

assert(
  laptop >= MAP_HEIGHT_DESKTOP_MIN_PX && laptop <= MAP_HEIGHT_DESKTOP_MAX_PX,
  `laptop expected 550–600, got ${laptop}`,
);
assert(
  desktop >= MAP_HEIGHT_DESKTOP_MIN_PX && desktop <= MAP_HEIGHT_DESKTOP_MAX_PX,
  `desktop expected 550–600, got ${desktop}`,
);
assert(
  iphone >= 360 && iphone <= 400,
  `iPhone expected 360–400, got ${iphone}`,
);

// --- Source wiring ---
assert(
  MAP_EMBED_HEIGHT_CLASS.includes("min-h-[360px]"),
  "embed class has min-h-[360px]",
);
assert(
  MAP_EMBED_HEIGHT_CLASS.includes("380px") &&
    MAP_EMBED_HEIGHT_CLASS.includes("sm:h-[min(60vh,600px)]") &&
    MAP_EMBED_HEIGHT_CLASS.includes("sm:min-h-[550px]"),
  "embed class uses ~380px mobile / ~60vh desktop clamped 550–600",
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
assert(synced.includes("min-h-[300px]") || synced.includes("min-h-[360px]"), "session workspace map floor");
assert(compare.includes("min-h-[300px]") || compare.includes("min-h-[360px]"), "compare map column floor");
assert(
  synced.includes("panel={workspace}") && synced.includes("compact={workspace}"),
  "session workspace still uses panel+compact map",
);
assert(
  trackMap.includes("Overview") && trackMap.includes("POV"),
  "Overview|POV toggle still present",
);

// Leaflet mount node must be stable — dynamic sfEditing classes on a WRAPPER only.
assert(
  leaflet.includes("wipes Leaflet") ||
    leaflet.includes("stable inner node"),
  "Leaflet documents className wipe / black-map fix",
);
assert(
  /data-apex-map="fixed-scrub"[\s\S]*?className="h-full w-full"|className="h-full w-full"[\s\S]*?data-apex-map="fixed-scrub"/.test(
    leaflet,
  ),
  "Leaflet map mount uses stable h-full w-full inner node",
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
    desktopBand: [MAP_HEIGHT_DESKTOP_MIN_PX, MAP_HEIGHT_DESKTOP_MAX_PX],
  }),
);
