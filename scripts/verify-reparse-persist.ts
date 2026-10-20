/**
 * Re-parse Save must stay under body limits and slim when sourceGps is set.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildReparseSaveBody,
  REPARSE_BODY_MAX_BYTES,
} from "../src/lib/reparse-save-body";
import {
  compactSourceGps,
  reparseLapsFromPoints,
} from "../src/lib/session-reparse";
import { resolveTrackStartFinish } from "../src/lib/track-start-finish";
import { resolveBuiltinAlias } from "../src/lib/tracks";
import type { TelemetryPoint } from "../src/lib/types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  resolveBuiltinAlias("custom-thunderhill-west") === "thunderhill-west",
  "custom track aliases builtin",
);
assert(
  resolveTrackStartFinish("custom-thunderhill-west") != null,
  "custom thunderhill west resolves SF without sharedTracksCache",
);

const fixturePath = [
  "/cursor/stores/self/fixtures/GL010057-session-gps.json",
  resolve(
    import.meta.dirname,
    "../src/lib/fixtures/gopro-thunderhill-west-session-gps.json",
  ),
].find((p) => existsSync(p));
assert(fixturePath, "fixture");

const fixture = JSON.parse(readFileSync(fixturePath!, "utf8")) as {
  points: Array<{ t: number; lat: number; lon: number; speed: number }>;
};
const points: TelemetryPoint[] = fixture.points.map((p) => ({
  t: p.t,
  lat: p.lat,
  lon: p.lon,
  speed: p.speed,
}));
const sf = resolveTrackStartFinish("custom-thunderhill-west");
const split = reparseLapsFromPoints(points, {
  trackId: "custom-thunderhill-west",
  startFinish: sf,
});
const sourceGps = compactSourceGps(points);
assert(sourceGps, "encode");

const fat = buildReparseSaveBody({
  laps: split.laps,
  sourceGps: null,
  trackId: "custom-thunderhill-west",
  startFinish: sf,
});
assert(!fat.slimmed, "no sourceGps → keep lap points");
assert(
  fat.body.laps?.[0]?.points?.length,
  "fat payload includes telemetry points",
);

const slim = buildReparseSaveBody({
  laps: split.laps,
  sourceGps,
  trackId: "custom-thunderhill-west",
  startFinish: sf,
});
assert(slim.slimmed, "with sourceGps → slim");
assert(
  slim.body.laps?.[0]?.points == null,
  "slim payload omits lap point arrays",
);
assert(slim.bytes < fat.bytes, "slim smaller than fat");
assert(
  slim.bytes < REPARSE_BODY_MAX_BYTES,
  `slim under cap (${slim.bytes} < ${REPARSE_BODY_MAX_BYTES})`,
);
assert(
  fat.bytes < REPARSE_BODY_MAX_BYTES || slim.bytes < fat.bytes / 2,
  "slim is the path that keeps Save under limits for full-res GPS",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      fatBytes: fat.bytes,
      slimBytes: slim.bytes,
      lapCount: split.laps.length,
      sourceGpsN: sourceGps.n,
    },
    null,
    2,
  ),
);
console.log("verify-reparse-persist: ok");
