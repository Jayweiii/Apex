/**
 * Guard: POV chase map must wire MapLibre v6 worker + keep lap line layers.
 * Without the public worker URL, GeoJSON routes never paint (basemap still works).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const chase = readFileSync(resolve(root, "src/components/ChaseTrackMap.tsx"), "utf8");
const workerLib = readFileSync(
  resolve(root, "src/lib/maplibre-worker.ts"),
  "utf8",
);
const copyScript = readFileSync(
  resolve(root, "scripts/copy-maplibre-worker.mjs"),
  "utf8",
);
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

assert(
  chase.includes("ensureMapLibreWorker"),
  "ChaseTrackMap calls ensureMapLibreWorker before MapLibre Map()",
);
assert(
  chase.includes('from "@/lib/maplibre-worker"'),
  "ChaseTrackMap imports maplibre-worker helper",
);
assert(
  /lap-line-/.test(chase) && /lap-src-/.test(chase),
  "ChaseTrackMap adds lap-line / lap-src GeoJSON layers",
);
assert(
  chase.includes("data-apex-route-lines") ||
    chase.includes("apex-route-lines"),
  "ChaseTrackMap exposes route-line count for Playwright",
);
assert(
  /drawnChaseKeyRef/.test(chase),
  "geometry drawKey guard still present (no progress-tick redraw)",
);
assert(
  workerLib.includes("setWorkerUrl") &&
    workerLib.includes("/maplibre-gl-worker.mjs"),
  "maplibre-worker sets public worker URL",
);
assert(
  copyScript.includes("maplibre-gl-worker.mjs") &&
    copyScript.includes("maplibre-gl-shared.mjs"),
  "copy script ships worker + shared module",
);
assert(
  typeof pkg.scripts?.postinstall === "string" &&
    pkg.scripts.postinstall.includes("copy-maplibre-worker"),
  "postinstall copies MapLibre worker into public/",
);
assert(
  typeof pkg.scripts?.prebuild === "string" &&
    pkg.scripts.prebuild.includes("copy-maplibre-worker"),
  "prebuild copies MapLibre worker into public/",
);

const publicWorker = resolve(root, "public/maplibre-gl-worker.mjs");
const publicShared = resolve(root, "public/maplibre-gl-shared.mjs");
assert(existsSync(publicWorker), "public/maplibre-gl-worker.mjs present");
assert(existsSync(publicShared), "public/maplibre-gl-shared.mjs present");

console.log("verify-pov-route: ok");
