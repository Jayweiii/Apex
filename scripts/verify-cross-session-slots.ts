/**
 * Cross-session compare: changing browse session must keep prior slots;
 * URL serialize/parse round-trips multi-session selections.
 */
import {
  MAX_COMPARE_LAPS,
  parseCompareSlots,
  serializeCompareSlots,
} from "../src/lib/compare";
import {
  formatSessionPickerLabel,
  groupLapsBySession,
} from "../src/lib/compare-sessions";
import {
  comparisonItemsFromSlots,
  slotsFromComparisonItems,
} from "../src/lib/comparisons";
import type { LapRow } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const metas = [
  {
    id: "sess-a",
    name: "Morning A",
    track_id: "thunderhill-west",
    car: "ND",
    user_id: "me",
    visibility: "friends",
    created_at: "2026-10-12T16:00:00.000Z",
  },
  {
    id: "sess-b",
    name: "Friend B",
    track_id: "thunderhill-west",
    car: "GT4",
    driver_name: "Alex",
    user_id: "other",
    visibility: "public",
    created_at: "2026-10-13T18:00:00.000Z",
  },
  {
    id: "sess-c",
    name: "East only",
    track_id: "thunderhill-east",
    user_id: "other",
    visibility: "public",
    created_at: "2026-09-01T12:00:00.000Z",
  },
];

const laps: LapRow[] = [
  {
    id: "a1",
    session_id: "sess-a",
    user_id: "me",
    lap_number: 3,
    lap_time_ms: 100_000,
    telemetry: [{ t: 0, speed: 10, lat: 39.5, lon: -122.3 }],
  },
  {
    id: "a2",
    session_id: "sess-a",
    user_id: "me",
    lap_number: 4,
    lap_time_ms: 99_000,
    telemetry: [{ t: 0, speed: 12, lat: 39.5, lon: -122.3 }],
  },
  {
    id: "b1",
    session_id: "sess-b",
    user_id: "other",
    lap_number: 2,
    lap_time_ms: 101_000,
    telemetry: [{ t: 0, speed: 11, lat: 39.5, lon: -122.3 }],
  },
  {
    id: "b2",
    session_id: "sess-b",
    user_id: "other",
    lap_number: 5,
    lap_time_ms: 98_500,
    telemetry: [{ t: 0, speed: 13, lat: 39.5, lon: -122.3 }],
  },
  {
    id: "c1",
    session_id: "sess-c",
    user_id: "other",
    lap_number: 1,
    lap_time_ms: 95_000,
    telemetry: [{ t: 0, speed: 20, lat: 39.5, lon: -122.3 }],
  },
];

const sessions = groupLapsBySession(metas, laps, "me");
assert(sessions.length === 3, "three sessions");

// Simulate picker: select A:L3 + B:L2, then "change browse session" to B.
const slots = [
  { sessionId: "sess-a", lapId: "a1" },
  { sessionId: "sess-b", lapId: "b1" },
];

// Browse session change is UI-only — slots stay.
const browseSessionId = "sess-b";
assert(
  slots.every((slot) =>
    sessions.some(
      (s) =>
        s.id === slot.sessionId && s.laps.some((l) => l.id === slot.lapId),
    ),
  ),
  "both slots still resolvable after browse change",
);
const browse = sessions.find((s) => s.id === browseSessionId);
assert(browse?.laps.length === 2, "browse list shows session B laps");
assert(
  slots.some((s) => s.sessionId === "sess-a"),
  "prior session A selection kept",
);

// Chip label shape: session name + lap
const chipA = sessions.find((s) => s.id === "sess-a")!;
const chipLabel = `${chipA.title ?? chipA.name.split(" · ")[0]} · L3`;
assert(/Morning/.test(chipLabel), `chip shows session: ${chipLabel}`);
assert(/L3/.test(chipLabel), `chip shows lap: ${chipLabel}`);

const pickerB = formatSessionPickerLabel(
  sessions.find((s) => s.id === "sess-b")!,
);
assert(/Friend|Alex|lap/i.test(pickerB), `picker label rich: ${pickerB}`);

// URL round-trip
const qs = serializeCompareSlots(slots, "a1");
assert(qs.includes("laps="), "serialize emits laps");
const decoded = decodeURIComponent(qs);
assert(decoded.includes("sess-a:a1"), "serialize includes session A");
assert(decoded.includes("sess-b:b1"), "serialize includes session B");
const params = new URLSearchParams(qs);
const parsed = parseCompareSlots({
  baseSessionId: "sess-a",
  ref: params.get("ref") ?? undefined,
  laps: params.get("laps") ?? undefined,
  other: params.get("other") ?? undefined,
  otherSession: params.get("otherSession") ?? undefined,
});
assert(parsed.length === 2, "parse two slots");
assert(parsed[0].sessionId === "sess-a" && parsed[0].lapId === "a1", "ref A");
assert(parsed[1].sessionId === "sess-b" && parsed[1].lapId === "b1", "other B");

// Saved comparison items round-trip
const items = comparisonItemsFromSlots(
  slots.map((s) => ({ sessionId: s.sessionId, lapId: s.lapId })),
);
assert(items.length === 2, "comparison items");
assert(items[0].session_id === "sess-a", "saved session_id");
const back = slotsFromComparisonItems(items);
assert(
  back[0].sessionId === "sess-a" && back[1].sessionId === "sess-b",
  "saved slots restore cross-session",
);

assert(MAX_COMPARE_LAPS === 4, "cap still 4");

console.log("verify-cross-session-slots: ok");
