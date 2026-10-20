import { buildCloudSessionPayload } from "../src/lib/save-session-cloud";
import type { ParsedLap } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const laps: ParsedLap[] = [
  {
    lapNumber: 1,
    lapTimeMs: 137100,
    points: [
      { t: 0, speed: 40 },
      { t: 10, speed: 120 },
    ],
    startOffsetSec: 5,
    startedAtMs: 1_700_000_005_000,
  },
  {
    lapNumber: 2,
    lapTimeMs: 140000,
    points: [
      { t: 0, speed: 42 },
      { t: 12, speed: 118 },
    ],
    startOffsetSec: 142.1,
  },
];

const payload = buildCloudSessionPayload("user-1", laps, {
  id: "sess-1",
  name: "Thunderhill morning",
  filename: "morning.csv",
  trackId: "thunderhill-east",
  car: "ND Miata",
  carClass: "Spec Miata",
  carTags: ["205"],
  driver: "Jason",
  sourceKind: "csv",
  rawObjectKey: "r2/sess-1/raw/morning.csv",
  storageBackend: "r2",
  startedAtMs: 1_700_000_000_000,
  sessionDate: "2026-09-20",
  videos: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      provider: "youtube",
      youtubeId: "BI0ZwJiqYk8",
      title: "Onboard",
      offsetSec: 12.5,
      rate: 1,
      syncSource: "manual",
      lapId: null,
    },
  ],
});

assert(payload.session.id === "sess-1", "session id preserved for R2 key match");
assert(payload.session.user_id === "user-1", "user id");
assert(payload.session.track_id === "thunderhill-east", "track");
assert(payload.session.car === "ND Miata", "car");
assert(payload.session.visibility === "friends", "default visibility friends");
assert(payload.session.raw_object_key === "r2/sess-1/raw/morning.csv", "raw key");
assert(payload.session.started_at === new Date(1_700_000_000_000).toISOString(), "started_at");
assert(payload.session.source_gps == null, "no source_gps without sourcePoints");
assert(payload.laps.length === 2, "two laps");
assert(payload.laps[0].start_offset_sec === 5, "lap start offset");
assert(payload.laps[0].telemetry != null, "telemetry kept");
assert(payload.videos.length === 1, "youtube video row");
assert(payload.videos[0].provider === "youtube", "video provider");
assert(payload.videos[0].youtube_id === "BI0ZwJiqYk8", "youtube id");
assert(payload.videos[0].offset_sec === 12.5, "offset persists");

const noYt = buildCloudSessionPayload("user-1", laps, {
  name: "No video",
  filename: null,
  trackId: "thunderhill-east",
  car: "ND",
  carClass: "Open",
  carTags: [],
  sourceKind: "gopro",
  videoObjectKey: "r2/ignored-mp4.mp4",
  sourcePoints: [
    { t: 0, lat: 39.5, lon: -122.3, speed: 40 },
    { t: 1, lat: 39.5001, lon: -122.3001, speed: 50 },
  ],
});
assert(noYt.videos.length === 0, "legacy videoObjectKey does not invent mp4 row");
const storedGps = noYt.session.source_gps as {
  v?: number;
  n?: number;
  enc?: string;
} | null;
assert(storedGps && storedGps.v === 2, "source_gps v2 stored on upload");
assert(storedGps.n === 2, "source_gps keeps both samples");
assert(storedGps.enc === "col-d32-gz-b64", "columnar gzip encoding");

const privatePayload = buildCloudSessionPayload("user-1", laps, {
  name: "Private run",
  filename: null,
  trackId: "thunderhill-east",
  car: "ND",
  carClass: "Open",
  carTags: [],
  sourceKind: "csv",
  visibility: "private",
});
assert(privatePayload.session.visibility === "private", "explicit private");

let threw = false;
try {
  buildCloudSessionPayload("user-1", laps, {
    name: "x",
    filename: null,
    trackId: "",
    car: "ND",
    carClass: "Open",
    carTags: [],
    sourceKind: "csv",
  });
} catch {
  threw = true;
}
assert(threw, "empty track should throw");

threw = false;
try {
  buildCloudSessionPayload("user-1", [], {
    name: "x",
    filename: null,
    trackId: "thunderhill-east",
    car: "ND",
    carClass: "Open",
    carTags: [],
    sourceKind: "csv",
  });
} catch {
  threw = true;
}
assert(threw, "empty laps should throw");

console.log("verify-cloud-save ok", {
  sessionId: payload.session.id,
  laps: payload.laps.length,
  videos: payload.videos.length,
});
