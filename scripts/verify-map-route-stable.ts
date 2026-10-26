/**
 * Session-page map flicker guard: route polyline redraw must key off geometry
 * identity (drawKey), not React progress ticks. Mirrors LeafletTrackMap /
 * ChaseTrackMap guards + SyncedLapView memoized traces.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function tracesKey(
  traces: Array<{
    id: string;
    points: Array<{ lat?: number; lon?: number }>;
    colorBySpeed?: boolean;
  }>,
) {
  return traces
    .map((trace) => {
      const first = trace.points[0];
      const last = trace.points[trace.points.length - 1];
      return `${trace.id}:${trace.points.length}:${first?.lat?.toFixed(5)}:${last?.lat?.toFixed(5)}:${trace.colorBySpeed ? 1 : 0}`;
    })
    .join("|");
}

const points = Array.from({ length: 40 }, (_, i) => ({
  lat: 39.5 + i * 0.0001,
  lon: -122.3 + i * 0.0001,
  speed: 80 + i,
}));

const tracesA = [{ id: "lap", points, colorBySpeed: true }];
const tracesB = [{ id: "lap", points, colorBySpeed: true }]; // new array, same geometry
const keyA = tracesKey(tracesA);
const keyB = tracesKey(tracesB);
assert(keyA === keyB, "drawKey stable across new array identity");

const tracesMoved = [
  {
    id: "lap",
    points: points.map((p, i) =>
      i === 0 ? { ...p, lat: p.lat + 0.01 } : p,
    ),
    colorBySpeed: true,
  },
];
assert(tracesKey(tracesMoved) !== keyA, "drawKey changes when geometry moves");

const leaflet = readFileSync(
  resolve("src/components/LeafletTrackMap.tsx"),
  "utf8",
);
assert(
  /drawnGeometryKeyRef/.test(leaflet),
  "LeafletTrackMap guards polyline redraw by geometry key",
);
assert(
  /progressSubscribe \? null : activeProgress/.test(leaflet),
  "LeafletTrackMap ignores activeProgress churn while subscribed",
);

const chase = readFileSync(
  resolve("src/components/ChaseTrackMap.tsx"),
  "utf8",
);
assert(
  /drawnChaseKeyRef/.test(chase),
  "ChaseTrackMap guards polyline redraw by geometry key",
);

const synced = readFileSync(
  resolve("src/components/video/SyncedLapView.tsx"),
  "utf8",
);
assert(
  /const mapTraces = useMemo/.test(synced),
  "SyncedLapView memoizes map traces",
);
assert(
  /activeProgress=\{clock\.playing \? undefined : clock\.progress\}/.test(
    synced,
  ),
  "SyncedLapView omits React progress while playing (subscribe owns clock)",
);

console.log("verify-map-route-stable: ok");
