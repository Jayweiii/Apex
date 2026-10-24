/**
 * Start/finish line geometry + Thunderhill West timing-line contract.
 */
import {
  ensureStartFinishEndpoints,
  headingFromGateEndpoints,
  moveStartFinishEndpoint,
  parseStartFinishLine,
  serializeStartFinishLine,
  startFinishDeltaMeters,
} from "../src/lib/start-finish-line";
import { resolveTrackStartFinish } from "../src/lib/track-start-finish";
import { STACKED_SPEED_MIN_HEIGHT } from "../src/lib/chart-height-contract";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const west = resolveTrackStartFinish("custom-thunderhill-west");
assert(west, "custom-thunderhill-west SF");
assert(
  Math.abs(west.lat - 39.53776) < 0.0005,
  `West SF lat on front straight, got ${west.lat}`,
);
assert(
  Math.abs(west.lon - -122.33875) < 0.0005,
  `West SF lon on timing line, got ${west.lon}`,
);

const builtin = resolveTrackStartFinish("thunderhill-west");
assert(builtin, "builtin thunderhill-west SF");
assert(
  Math.abs(builtin.lat - 39.53776) < 0.0005,
  `builtin West SF lat, got ${builtin.lat}`,
);

const stored = parseStartFinishLine({
  lat: 39.53776,
  lon: -122.33875,
  headingDeg: 175,
  a: { lat: 39.53776, lon: -122.33888 },
  b: { lat: 39.53776, lon: -122.33862 },
});
assert(stored, "parse stored SF");
const withEnds = ensureStartFinishEndpoints(stored);
assert(withEnds.a && withEnds.b, "endpoints present");

const moved = moveStartFinishEndpoint(withEnds, "a", {
  lat: 39.5378,
  lon: -122.339,
});
assert(moved.a && moved.b, "moved keeps endpoints");
assert(
  Math.abs(moved.a.lat - 39.5378) < 1e-9,
  "endpoint A updated",
);
assert(
  Math.abs(moved.b!.lon - withEnds.b!.lon) < 1e-9,
  "endpoint B unchanged",
);

const heading = headingFromGateEndpoints(withEnds.a!, withEnds.b!);
assert(Number.isFinite(heading), "heading from gate");

const roundTrip = parseStartFinishLine(serializeStartFinishLine(moved));
assert(roundTrip, "serialize round-trip");
assert(
  (startFinishDeltaMeters(moved, roundTrip) ?? 99) < 0.5,
  "round-trip midpoint within 0.5 m",
);

// Prefer stored gate over catalog when provided.
const nudged = resolveTrackStartFinish("custom-thunderhill-west", undefined, {
  lat: 39.5375,
  lon: -122.3387,
});
assert(nudged, "stored override");
assert(
  Math.abs(nudged.lat - 39.5375) < 1e-9,
  "stored start_finish wins over catalog",
);

assert(
  STACKED_SPEED_MIN_HEIGHT >= 160,
  `speed chart height floor ${STACKED_SPEED_MIN_HEIGHT}`,
);

// Leaflet SF editor: dynamic classes must not sit on the map mount node.
const leafletSrc = require("node:fs").readFileSync(
  require("node:path").join(__dirname, "../src/components/LeafletTrackMap.tsx"),
  "utf8",
);
assert(
  leafletSrc.includes('className="h-full w-full"') &&
    leafletSrc.includes("data-apex-map=\"fixed-scrub\""),
  "SF map mount node is stable (avoids black tiles on edit)",
);
assert(
  leafletSrc.includes("sfEditing") && leafletSrc.includes("apex-sf-handle"),
  "SF handles still wired",
);

assert(
  nudged.locked === true,
  "stored start_finish marks SF locked for split",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      thunderhillWest: west,
      headingDeg: Math.round(heading),
      speedChartMinHeightPx: STACKED_SPEED_MIN_HEIGHT,
      storedLocked: nudged.locked === true,
    },
    null,
    2,
  ),
);
