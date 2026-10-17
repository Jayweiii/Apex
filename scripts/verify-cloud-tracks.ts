import { cloudRowToTrack } from "../src/lib/cloud-tracks";
import { findTrackByName, normalizeTrackQuery } from "../src/lib/tracks";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const row = cloudRowToTrack({
  id: "custom-thunderhill-west",
  name: "Thunderhill West",
  location: "Community",
  layout: "West",
  lat: 39.5,
  lon: -122.3,
});
assert(row.id === "custom-thunderhill-west", "id");
assert(row.name === "Thunderhill West", "name");
assert(row.popularity === 1, "shared popularity");
assert(normalizeTrackQuery("Thunderhill West") === "thunderhill west", "normalize");

const shared = [
  row,
  cloudRowToTrack({
    id: "custom-other",
    name: "Other",
    location: "Community",
    lat: 0,
    lon: 0,
  }),
];
assert(findTrackByName("thunderhill west", shared)?.id === row.id, "find by name");
assert(findTrackByName("THUNDERHILL WEST", shared)?.id === row.id, "case insensitive");

console.log("verify-cloud-tracks ok", { id: row.id });
