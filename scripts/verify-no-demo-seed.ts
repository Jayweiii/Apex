/**
 * Ensures the app does not auto-seed demo/public catalog sessions or
 * placeholder world circuits at init.
 */
import { CATALOG_SESSIONS, getCatalogSession } from "../src/lib/catalog";
import { TRACKS, getTrack } from "../src/lib/tracks";
import { builtinCenterline } from "../src/lib/centerlines";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(CATALOG_SESSIONS.length === 0, "catalog must be empty at init");
assert(getCatalogSession("demo-laguna-seca-gt3") == null, "no demo deep-link");
assert(getCatalogSession("pub-spreewaldring-stc") == null, "no auto public seed");

const allowed = new Set([
  "thunderhill-east",
  "thunderhill-west",
  "buttonwillow-13cw",
  "streets-of-willow-cw",
]);
assert(TRACKS.length === 4, `expected 4 builtin tracks, got ${TRACKS.length}`);
for (const track of TRACKS) {
  assert(allowed.has(track.id), `unexpected builtin track ${track.id}`);
  assert(Number.isFinite(track.lat) && track.lat !== 0, `${track.id} lat`);
  assert(Number.isFinite(track.lon) && track.lon !== 0, `${track.id} lon`);
}

assert(getTrack("laguna-seca") == null, "laguna-seca removed");
assert(getTrack("spa") == null, "spa removed");
assert(getTrack("spreewaldring") == null, "spreewaldring removed");
assert(builtinCenterline("laguna-seca") == null, "no laguna centerline");
assert(builtinCenterline("thunderhill-east") != null, "thunderhill centerline kept");

console.log("verify-no-demo-seed ok", {
  tracks: TRACKS.map((t) => t.id),
  catalog: CATALOG_SESSIONS.length,
});
