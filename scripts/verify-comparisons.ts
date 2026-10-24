/**
 * Saved comparisons helpers (normalize, parse, share path).
 */
import {
  comparisonItemsFromSlots,
  comparisonSharePath,
  defaultComparisonTitle,
  normalizeComparisonItems,
  parseComparisonRow,
  remapComparisonItemsByLapNumber,
  resolveComparisonItemsAgainstLaps,
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

// Re-parse leaves stale lap_ids; resolve via lap_number.
const stale = normalizeComparisonItems([
  {
    session_id: "sess-a",
    lap_id: "old-lap-8",
    lap_number: 8,
    color: "#f97316",
  },
  {
    session_id: "sess-a",
    lap_id: "old-lap-10",
    lap_number: 10,
    color: "#38bdf8",
  },
]);
const liveLaps = [
  { id: "new-lap-8", session_id: "sess-a", lap_number: 8 },
  { id: "new-lap-10", session_id: "sess-a", lap_number: 10 },
];
const resolved = resolveComparisonItemsAgainstLaps(stale, liveLaps);
assert(resolved.missing.length === 0, "stale ids resolve via lap_number");
assert(resolved.remappedCount === 2, "both items remapped");
assert(resolved.resolved[0].lap_id === "new-lap-8", "lap 8 id");
assert(resolved.resolved[1].lap_id === "new-lap-10", "lap 10 id");

const remapped = remapComparisonItemsByLapNumber(
  stale,
  "sess-a",
  new Map([
    ["old-lap-8", 8],
    ["old-lap-10", 10],
  ]),
  new Map([
    [8, "new-lap-8"],
    [10, "new-lap-10"],
  ]),
);
assert(remapped.changed, "reparse remap changes items");
assert(remapped.items[0].lap_id === "new-lap-8", "persist lap 8");

console.log("verify-comparisons ok", {
  items: items.length,
  title: row.title,
  path: comparisonSharePath(row.id),
  remapped: resolved.remappedCount,
});
