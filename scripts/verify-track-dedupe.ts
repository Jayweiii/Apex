/**
 * Preset ↔ community track identity (Thunderhill West and friends).
 */
import { cloudRowToTrack } from "../src/lib/cloud-tracks";
import {
  dedupeTracksByIdentity,
  findTrackByName,
  popularTracks,
  preferTrackDuplicate,
  resolveBuiltinAlias,
  resolveCanonicalTrack,
  setSharedTracksCache,
  trackEquivalentIds,
  trackIdentityKey,
  TRACKS,
} from "../src/lib/tracks";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  trackIdentityKey("Thunderhill Raceway — West") === "thunderhill west",
  "builtin west key",
);
assert(
  trackIdentityKey("Thunderhill West") === "thunderhill west",
  "community west key",
);
assert(
  trackIdentityKey("Thunderhill Raceway — East") === "thunderhill east",
  "east stays distinct",
);
assert(
  trackIdentityKey("Thunderhill West") !==
    trackIdentityKey("Thunderhill Raceway — East"),
  "east ≠ west",
);

const communityWest = cloudRowToTrack({
  id: "custom-thunderhill-west",
  name: "Thunderhill West",
  location: "Community",
  lat: 0,
  lon: 0,
});
const builtinWest = TRACKS.find((t) => t.id === "thunderhill-west");
assert(builtinWest, "builtin west present");

const merged = preferTrackDuplicate(builtinWest, communityWest);
assert(merged.id === "custom-thunderhill-west", "prefer community id (sessions)");
assert(merged.lat === builtinWest.lat, "inherit builtin lat");
assert(merged.lon === builtinWest.lon, "inherit builtin lon");
assert(
  merged.popularity >= builtinWest.popularity,
  "keep builtin popularity rank",
);

setSharedTracksCache([communityWest]);
const listed = popularTracks("");
const westRows = listed.filter(
  (t) => trackIdentityKey(t.name) === "thunderhill west",
);
assert(westRows.length === 1, `exactly one Thunderhill West, got ${westRows.length}`);
assert(
  westRows[0].id === "custom-thunderhill-west",
  "list shows community row with sessions",
);
assert(
  !listed.some((t) => t.id === "thunderhill-west"),
  "builtin west hidden when community duplicate exists",
);

assert(
  findTrackByName("Thunderhill West")?.id === "custom-thunderhill-west",
  "find prefers community when cached",
);
assert(
  findTrackByName("thunderhill raceway west", [])?.id === "thunderhill-west",
  "find builtin alone by fuzzy name",
);

setSharedTracksCache([communityWest]);
assert(
  resolveBuiltinAlias("custom-thunderhill-west") === "thunderhill-west",
  "alias community → builtin",
);
assert(resolveBuiltinAlias("thunderhill-west") === "thunderhill-west", "alias self");
assert(resolveBuiltinAlias("custom-other") == null, "no alias for unknown");

const eastOnly = dedupeTracksByIdentity([
  TRACKS.find((t) => t.id === "thunderhill-east")!,
  cloudRowToTrack({
    id: "custom-thunderhill-east-dupe",
    name: "Thunderhill East",
    location: "Community",
    lat: 0,
    lon: 0,
  }),
]);
assert(eastOnly.length === 1, "east preset+community deduped");
assert(
  eastOnly[0].id === "custom-thunderhill-east-dupe",
  "east prefers community id",
);

setSharedTracksCache([communityWest]);
assert(
  resolveCanonicalTrack("thunderhill-west")?.id === "custom-thunderhill-west",
  "canonical prefers community for builtin url",
);
const equiv = trackEquivalentIds("thunderhill-west");
assert(equiv.includes("thunderhill-west"), "equiv includes builtin");
assert(equiv.includes("custom-thunderhill-west"), "equiv includes community");

setSharedTracksCache([]);

console.log("verify-track-dedupe ok", {
  westListId: westRows[0].id,
  identity: trackIdentityKey("Thunderhill Raceway — West"),
});
