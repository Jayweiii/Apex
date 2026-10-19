/**
 * Shared cars catalog helpers (no demo seeds).
 */
import { carKey, normalizeCarName } from "../src/lib/cloud-cars";
import { listKnownCars, rememberKnownCar } from "../src/lib/local-store";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(normalizeCarName("  Nd Miata ") === "Nd Miata", "trim + collapse");
assert(normalizeCarName("MX-5") === "MX-5", "keep hyphen/case");
assert(carKey("  Nd Miata ") === "nd miata", "case-insensitive key");
assert(carKey("MX-5") === carKey("mx-5"), "key ignores case");

// rememberKnownCar is browser-only; under Node it no-ops.
rememberKnownCar("Test Car");
const known = listKnownCars();
assert(Array.isArray(known), "listKnownCars returns array");

// Never hardcode demo cars into the catalog.
assert(
  !known.includes("Demo GT3") && !known.includes("Placeholder Miata"),
  "no demo car names",
);

console.log("verify-cloud-cars ok", {
  normalize: normalizeCarName("987.2 Cayman"),
  knownCount: known.length,
});
