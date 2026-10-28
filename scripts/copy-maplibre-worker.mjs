/**
 * Copy MapLibre GL JS v6 worker + shared module into public/ so Next.js can
 * serve them at a stable URL. GeoJSON lap lines run in this worker — without
 * it, POV chase maps show basemap + HTML markers but no route polylines
 * ("Worker failed to load").
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const entry = require.resolve("maplibre-gl/dist/maplibre-gl.mjs");
const dist = dirname(entry);
const publicDir = join(process.cwd(), "public");
mkdirSync(publicDir, { recursive: true });

const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
for (const file of files) {
  const src = join(dist, file);
  if (!existsSync(src)) {
    throw new Error(`Missing MapLibre worker asset: ${src}`);
  }
  copyFileSync(src, join(publicDir, file));
}

console.log(
  `copy-maplibre-worker: wrote ${files.join(", ")} → public/ (from ${dist})`,
);
