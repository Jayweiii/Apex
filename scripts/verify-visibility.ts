import {
  DEFAULT_VISIBILITY,
  isCloudSessionId,
  isSessionVisibility,
  normalizeVisibility,
} from "../src/lib/visibility";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(DEFAULT_VISIBILITY === "friends", "default friends");
assert(isSessionVisibility("private"), "private ok");
assert(isSessionVisibility("friends"), "friends ok");
assert(isSessionVisibility("public"), "public ok");
assert(!isSessionVisibility("everyone"), "reject everyone");
assert(normalizeVisibility(null) === "friends", "null → friends");
assert(normalizeVisibility("public") === "public", "keep public");
assert(
  isCloudSessionId("2a553561-b383-46e5-9508-a2ad063952c4"),
  "jason upload uuid",
);
assert(!isCloudSessionId("demo-legacy"), "demo prefix not cloud");
assert(!isCloudSessionId("pub-legacy"), "pub prefix not cloud");

// Public upload that needs backfill after migration
assert(
  isCloudSessionId("1c782e8b-c306-4c05-90d6-738bb948eee8"),
  "jason public attempt uuid",
);

console.log("verify-visibility ok");
