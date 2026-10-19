/**
 * Saved comparisons helpers (normalize, parse, share path).
 */
import {
  comparisonItemsFromSlots,
  comparisonSharePath,
  defaultComparisonTitle,
  normalizeComparisonItems,
  parseComparisonRow,
  slotsFromComparisonItems,
} from "../src/lib/comparisons";
import { MAX_COMPARE_LAPS } from "../src/lib/compare";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const raw = [
  {
    session_id: "s1",
    lap_id: "l1",
    lap_number: 1,
    color: "#f97316",
  },
  {
    session_id: "s1",
    lap_id: "l2",
    lap_number: 2,
  },
  {
    session_id: "s2",
    lap_id: "l3",
    lap_number: 1,
    offset_sec: 12.5,
  },
  {
    session_id: "s2",
    lap_id: "l4",
  },
  {
    session_id: "s3",
    lap_id: "l5",
  },
];

const items = normalizeComparisonItems(raw);
assert(items.length === MAX_COMPARE_LAPS, `cap at ${MAX_COMPARE_LAPS}`);
assert(items[2].offset_sec === 12.5, "offset preserved");
assert(items[1].color, "default color filled");

const slots = slotsFromComparisonItems(items);
assert(slots[0].sessionId === "s1" && slots[0].lapId === "l1", "slot map");

const roundTrip = comparisonItemsFromSlots(
  slots.map((s, i) => ({
    sessionId: s.sessionId,
    lapId: s.lapId,
    lapNumber: i + 1,
    color: items[i].color,
  })),
);
assert(roundTrip.length === 4, "round trip");

assert(
  defaultComparisonTitle(items).includes("L1"),
  `title ${defaultComparisonTitle(items)}`,
);
assert(comparisonSharePath("abc") === "/compare/abc", "share path");

const row = parseComparisonRow({
  id: "c1",
  user_id: "u1",
  title: "  Thunderhill duel  ",
  description: null,
  visibility: "public",
  items,
  reference_index: 2,
  analysis_mode: "raw",
  cursor_state: { progress: 0.4 },
  forked_from: null,
  created_at: "2026-10-19T00:00:00Z",
  updated_at: "2026-10-19T00:00:00Z",
});
assert(row.title === "Thunderhill duel", "trim title");
assert(row.reference_index === 2, "ref index");
assert(row.analysis_mode === "raw", "analysis mode");
assert(row.visibility === "public", "visibility");
assert(row.cursor_state?.progress === 0.4, "cursor");

const bad = normalizeComparisonItems([
  { session_id: "", lap_id: "x" },
  { foo: 1 },
  null,
]);
assert(bad.length === 0, "rejects invalid items");

console.log("verify-comparisons ok", {
  items: items.length,
  title: row.title,
  path: comparisonSharePath(row.id),
});
