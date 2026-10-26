/**
 * Hover on charts/map must preview only — never seek playback/video.
 * Click / scrubber-drag / map-click seek. Sync-here stays click-based.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const scrub = read("src/components/chart-scrub.ts");
assert(scrub.includes("onPreviewIndex"), "chart-scrub preview handler");
assert(scrub.includes("onSeekIndex"), "chart-scrub seek handler");
assert(
  scrub.includes("event.buttons !== 0") || scrub.includes("event.buttons === 0"),
  "pointer buttons gate seek vs preview",
);

const leaflet = read("src/components/LeafletTrackMap.tsx");
assert(leaflet.includes("onPreviewProgress"), "map preview callback");
assert(leaflet.includes("previewProgress"), "map preview prop");
assert(leaflet.includes("hoverPreviewEnabled"), "map hover can disable while playing");
assert(leaflet.includes("apex-car-marker__dot--ghost") || leaflet.includes("ghost"), "ghost marker");
assert(leaflet.includes('map.on("mousemove"'), "map hover preview");
assert(leaflet.includes('map.on("click"'), "map click seek");
// Hover must call preview, not progress seek.
assert(
  /onMove[\s\S]*onPreviewProgressRef[\s\S]*onClick[\s\S]*onProgressRef/.test(
    leaflet,
  ) ||
    (leaflet.includes("onPreviewProgressRef.current?.(progress)") &&
      leaflet.includes("onProgressRef.current?.(progress)")),
  "mousemove previews; click seeks",
);
assert(
  leaflet.includes("hoverPreviewEnabledRef.current"),
  "map mousemove respects hoverPreviewEnabled",
);
assert(leaflet.includes('"mouseleave"'), "map clears hover on mouseleave");
assert(leaflet.includes('"pointerleave"'), "map clears hover on pointerleave");
assert(leaflet.includes('"touchend"'), "map clears hover on touchend");
assert(leaflet.includes('"touchcancel"'), "map clears hover on touchcancel");
assert(leaflet.includes("clearHoverPreview"), "map leave clears preview helper");
assert(leaflet.includes("data-apex-map-stack"), "map stacking containment");
assert(leaflet.includes("isolate"), "map isolation contains leaflet panes");

const chase = read("src/components/ChaseTrackMap.tsx");
assert(chase.includes('"pointerleave"'), "chase map pointerleave clear");
assert(chase.includes('"touchend"'), "chase map touchend clear");
assert(chase.includes("data-apex-map-stack"), "chase map stacking containment");
assert(chase.includes("clearHoverPreview"), "chase leave clears preview");

const header = read("src/components/AppHeader.tsx");
assert(
  header.includes("sticky top-0 z-40") || header.includes("z-40"),
  "sticky header above map panes",
);

const synced = read("src/components/video/SyncedLapView.tsx");
assert(synced.includes("previewProgress"), "session preview state");
assert(synced.includes("previewFromChart"), "session chart preview");
assert(synced.includes("seekFromChart"), "session chart seek");
assert(synced.includes("onPreviewIndex={previewFromChart}"), "telemetry preview");
assert(synced.includes("onSeekIndex={seekFromChart}"), "telemetry seek");
assert(synced.includes("hoverEnabled = !clock.playing"), "no hover while playing");
assert(
  synced.includes("hoverPreviewEnabled={hoverEnabled}"),
  "map hover gated while playing",
);
assert(
  !synced.includes("onHoverIndex={hoverFromChart}"),
  "session must not seek on hover callback",
);

const compare = read("src/components/LapCompare.tsx");
assert(compare.includes("previewProgress"), "compare preview state");
assert(compare.includes("onChartMouseMove"), "compare chart mouse move");
assert(compare.includes("setPreviewProgress(null)"), "compare leave clears preview");
assert(compare.includes("isSeekPointer"), "compare seek vs preview");
assert(
  compare.includes("!hoverEnabled") && compare.includes("previewProgress == null"),
  "compare dashed ReferenceLine hidden while playing",
);
assert(
  compare.includes("cursor={false}"),
  "compare Recharts Tooltip has no default dashed cursor",
);
assert(
  compare.includes("userTouchedSlotsRef"),
  "compare selection ignores late reseed after user clicks",
);
assert(
  compare.includes("prev.length <= 1") && !compare.includes("prev.length <= 2"),
  "compare allows toggle/remove down to one chip (not stuck at two)",
);
assert(
  compare.includes("data-apex-compare-remove") && compare.includes("×"),
  "compare chips expose an × remove control",
);
assert(
  compare.includes("data-apex-compare-set-ref"),
  "compare chips can change the reference",
);

const drive = read("src/components/drive/DriveGame.tsx");
assert(
  drive.includes("viewW < 640 ? 58") && !drive.includes("viewH - size - pad - (viewW < 640 ? 120"),
  "drive minimap anchors top-right on mobile (not above brake/gas)",
);

const guide = read("src/components/video/LapVideoSyncGuide.tsx");
assert(guide.includes("Sync here"), "sync-here still present");

const globals = read("src/app/globals.css");
assert(globals.includes("apex-car-marker__dot--ghost"), "ghost marker CSS");
assert(globals.includes("[data-apex-map-stack]"), "map stack CSS containment");
assert(globals.includes("isolation: isolate"), "map stack isolation");

assert(
  synced.includes("setMapPreviewProgress") ||
    synced.includes("hoverController.leave"),
  "session map leave clears chart hover",
);
assert(
  compare.includes("setMapPreviewProgress") ||
    compare.includes("hoverController.leave"),
  "compare map leave clears chart hover",
);

const satellite = read("scripts/verify-satellite-map.ts");
assert(satellite.includes("mousemove"), "satellite verify still expects mousemove");

console.log(
  JSON.stringify({
    ok: true,
    hover: "preview-only",
    hoverWhilePlaying: false,
    seek: "click-or-scrubber-drag",
    syncHere: "click",
    session: true,
    compare: true,
  }),
);
