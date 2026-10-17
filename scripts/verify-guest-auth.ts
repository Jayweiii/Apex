import {
  GUEST_DEFAULT_VISIBILITY,
  DEFAULT_VISIBILITY,
  defaultVisibilityForUser,
} from "../src/lib/visibility";
import {
  MAX_CSV_BYTES,
  MAX_VIDEO_BYTES,
  assertFileWithinLimits,
} from "../src/lib/abuse-limits";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(GUEST_DEFAULT_VISIBILITY === "public", "guest default public");
assert(DEFAULT_VISIBILITY === "friends", "signed-in default friends");
assert(defaultVisibilityForUser(true) === "public", "anon → public");
assert(defaultVisibilityForUser(false) === "friends", "email → friends");
assert(MAX_CSV_BYTES < MAX_VIDEO_BYTES, "csv smaller than video");

let threw = false;
try {
  assertFileWithinLimits(
    { size: MAX_CSV_BYTES + 1, name: "big.csv" } as File,
    "csv",
  );
} catch {
  threw = true;
}
assert(threw, "oversized csv throws");

console.log("verify-guest-auth ok", {
  guest: GUEST_DEFAULT_VISIBILITY,
  maxCsvMb: MAX_CSV_BYTES / (1024 * 1024),
});
