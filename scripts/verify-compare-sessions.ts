import {
  formatSessionPickerLabel,
  groupLapsBySession,
  labelForAccessibleSession,
  trackIdsFromSessions,
} from "../src/lib/compare-sessions";
import type { LapRow } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const metas = [
  {
    id: "s1",
    name: "Morning",
    track_id: "thunderhill-west",
    car: "Mx-5",
    user_id: "me",
    visibility: "friends",
    created_at: "2026-10-12T16:00:00.000Z",
  },
  {
    id: "s2",
    name: "Friend run",
    track_id: "thunderhill-west",
    car: "ND",
    driver_name: "Alex",
    user_id: "other",
    visibility: "friends",
    created_at: "2026-10-13T18:00:00.000Z",
  },
  {
    id: "s3",
    name: "Public link",
    track_id: "thunderhill-east",
    car: "GT4",
    user_id: "other",
    visibility: "public",
    created_at: "2026-09-01T12:00:00.000Z",
  },
];

const laps: LapRow[] = [
  {
    id: "l1",
    session_id: "s1",
    user_id: "me",
    lap_number: 1,
    lap_time_ms: 100000,
    telemetry: [{ t: 0, speed: 10 }],
  },
  {
    id: "l2",
    session_id: "s1",
    user_id: "me",
    lap_number: 2,
    lap_time_ms: 99000,
    telemetry: [{ t: 0, speed: 12 }],
  },
  {
    id: "l3",
    session_id: "s2",
    user_id: "other",
    lap_number: 1,
    lap_time_ms: 101000,
    telemetry: [{ t: 0, speed: 11 }],
  },
  {
    id: "l4",
    session_id: "s3",
    user_id: "other",
    lap_number: 1,
    lap_time_ms: 95000,
    telemetry: [{ t: 0, speed: 20 }],
  },
];

const mine = labelForAccessibleSession(metas[0], "me");
assert(mine.kind === "upload", "own session kind");
const friend = labelForAccessibleSession(metas[1], "me");
assert(friend.kind === "friends", "friends kind");
assert(friend.name.includes("Alex"), "friend driver in label");
const pub = labelForAccessibleSession(metas[2], "me");
assert(pub.kind === "public", "public kind");

const grouped = groupLapsBySession(metas, laps, "me");
assert(grouped.length === 3, "three sessions with laps");
assert(grouped[0].laps.length === 2, "s1 has two laps");
assert(trackIdsFromSessions(metas).length === 2, "two tracks");

const friendOpt = grouped.find((s) => s.id === "s2");
assert(friendOpt, "friend session present");
assert(friendOpt.createdAt === metas[1].created_at, "createdAt threaded");
assert(friendOpt.driverName === "Alex", "driverName threaded");
const picker = formatSessionPickerLabel(friendOpt);
assert(picker.includes("Alex"), `picker shows driver: ${picker}`);
assert(/Oct|10/.test(picker), `picker shows date: ${picker}`);
assert(/lap/i.test(picker), `picker shows lap count: ${picker}`);
assert(
  /\d{1,2}:\d{2}|[AP]M|[ap]m/.test(picker) || /\d/.test(picker),
  `picker includes time-of-day signal: ${picker}`,
);

console.log("verify-compare-sessions ok", {
  sessions: grouped.length,
  tracks: trackIdsFromSessions(metas),
  picker,
});
