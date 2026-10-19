/**
 * Video↔GPS sync: MP4 creation_time, event offsets, dual-compare lap-start align.
 */
import {
  parseQuickTimeCreationDate,
  readMp4CreationTime,
  suggestOffsetFromCreationTime,
} from "../src/lib/mp4-creation-time";
import {
  findSyncEventLapTime,
  offsetForSessionMoment,
  sessionTimeForLapEvent,
} from "../src/lib/sync-events";
import {
  dualCompareAlignedAtLapStart,
  dualVideoTimeAtProgress,
  lapAsSyncLap,
  type DualVideoSide,
} from "../src/lib/dual-video-sync";
import { suggestOffsetFromVideoStart } from "../src/lib/video-sync";
import {
  resolveMp4Playback,
  rowToSessionVideo,
  sessionVideoToInsert,
} from "../src/lib/session-videos-cloud";
import type { SessionVideo, TelemetryPoint } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function writeU32(buf: Uint8Array, offset: number, value: number) {
  buf[offset] = (value >>> 24) & 0xff;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

function fourccBytes(tag: string): number[] {
  return [tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)];
}

/** Minimal moov/mvhd MP4 with known Mac-epoch creation_time. */
function buildMinimalMp4WithMvhd(macCreationSec: number): Blob {
  // mvhd version 0 body: version/flags(4) + ctime(4) + mtime(4) + timescale(4) + duration(4) + rest
  const mvhdBody = new Uint8Array(100);
  mvhdBody[0] = 0; // version
  writeU32(mvhdBody, 4, macCreationSec);
  writeU32(mvhdBody, 8, macCreationSec);
  writeU32(mvhdBody, 12, 1000); // timescale
  writeU32(mvhdBody, 16, 5000); // duration

  const mvhd = new Uint8Array(8 + mvhdBody.length);
  writeU32(mvhd, 0, mvhd.length);
  mvhd.set(fourccBytes("mvhd"), 4);
  mvhd.set(mvhdBody, 8);

  const moov = new Uint8Array(8 + mvhd.length);
  writeU32(moov, 0, moov.length);
  moov.set(fourccBytes("moov"), 4);
  moov.set(mvhd, 8);

  const ftyp = new Uint8Array(20);
  writeU32(ftyp, 0, 20);
  ftyp.set(fourccBytes("ftyp"), 4);
  ftyp.set(fourccBytes("isom"), 8);
  writeU32(ftyp, 12, 0);
  ftyp.set(fourccBytes("isom"), 16);

  const bytes = new Uint8Array(ftyp.length + moov.length);
  bytes.set(ftyp, 0);
  bytes.set(moov, ftyp.length);
  return new Blob([bytes], { type: "video/mp4" });
}

// --- QuickTime creationdate (iPhone local offset) ---
const qtMs = parseQuickTimeCreationDate("2024-06-15T14:30:00-0700");
assert(qtMs != null, "parse QT creationdate");
const qt = new Date(qtMs!);
assert(qt.getUTCFullYear() === 2024, `year ${qt.getUTCFullYear()}`);
assert(qt.getUTCHours() === 21, `utc hours ${qt.getUTCHours()} (14:30-0700 → 21:30Z)`);

const zulu = parseQuickTimeCreationDate("2025-03-01T18:00:00Z");
assert(zulu === Date.parse("2025-03-01T18:00:00Z"), "Zulu creationdate");

async function main() {
  // --- mvhd creation_time ---
  const MAC_EPOCH = 2082844800;
  const unixSec = Math.floor(Date.parse("2024-06-15T21:30:00Z") / 1000);
  const macSec = unixSec + MAC_EPOCH;
  const blob = buildMinimalMp4WithMvhd(macSec);
  const meta = await readMp4CreationTime(blob);
  assert(meta.source === "mvhd", `source ${meta.source}`);
  assert(meta.creationTimeMs != null, "mvhd creationTimeMs");
  assert(
    Math.abs(meta.creationTimeMs! - unixSec * 1000) < 1000,
    `mvhd ms ${meta.creationTimeMs}`,
  );

  // --- auto offset vs session UTC start ---
  const sessionStart = Date.parse("2024-06-15T21:25:00Z");
  const suggested = suggestOffsetFromCreationTime(
    meta.creationTimeMs!,
    sessionStart,
  );
  assert(Math.abs(suggested - 300) < 1, `suggest 5min → ${suggested}`);
  assert(
    Math.abs(
      suggestOffsetFromVideoStart(meta.creationTimeMs!, sessionStart) -
        suggested,
    ) < 1e-9,
    "matches video-sync helper",
  );

  // --- event pair offset ---
  const videoTime = 42.5;
  const lapStart = 10;
  const firstBrakeLapT = 8.2;
  const sessionT = sessionTimeForLapEvent(lapStart, firstBrakeLapT);
  const offset = offsetForSessionMoment(videoTime, sessionT);
  assert(Math.abs(offset - (42.5 - 18.2)) < 1e-9, `event offset ${offset}`);

  const points: TelemetryPoint[] = [
    { t: 0, speed: 40, lonG: 0.1, latG: 0.1 },
    { t: 2, speed: 80, lonG: 0.05, latG: 0.05 },
    { t: 4, speed: 110, lonG: -0.05, latG: 0.1 },
    { t: 5.5, speed: 105, lonG: -0.4, latG: 0.2 }, // first brake
    { t: 7, speed: 70, lonG: -0.2, latG: 0.5 },
    { t: 9, speed: 55, lonG: 0.1, latG: 0.6 },
    { t: 12, speed: 90, lonG: 0.1, latG: 0.1 },
    { t: 14, speed: 120, lonG: 0.05, latG: 0.05 },
    { t: 16, speed: 130, lonG: 0.02, latG: 0.05 },
    { t: 18, speed: 135, lonG: 0.01, latG: 0.04 },
  ];
  assert(findSyncEventLapTime(points, "lap_start") === 0, "lap start");
  const brakeT = findSyncEventLapTime(points, "first_brake");
  assert(brakeT === 5.5, `first brake ${brakeT}`);
  const straightT = findSyncEventLapTime(points, "straight_start");
  assert(straightT != null && straightT > brakeT!, `straight ${straightT}`);

  // --- cloud row mapping preserves offsetSec (YouTube-only onboards) ---
  const video: SessionVideo = {
    id: "11111111-1111-1111-1111-111111111111",
    provider: "youtube",
    youtubeId: "BI0ZwJiqYk8",
    title: "Thunderhill onboard",
    offsetSec: 12.34,
    rate: 1,
    syncSource: "time_of_day",
    videoStartedAtMs: meta.creationTimeMs!,
  };
  const insert = sessionVideoToInsert(video, "sess", "user");
  assert(insert.offset_sec === 12.34, "insert offset");
  assert(insert.provider === "youtube", "youtube provider");
  assert(insert.video_started_at != null, "insert started");
  const roundTrip = rowToSessionVideo({
    id: video.id,
    session_id: "sess",
    provider: "youtube",
    youtube_id: "BI0ZwJiqYk8",
    offset_sec: insert.offset_sec,
    rate: 1,
    sync_source: "time_of_day",
    video_started_at: insert.video_started_at,
    title: video.title,
  });
  assert(Math.abs(roundTrip.offsetSec - 12.34) < 1e-9, "roundtrip offset");
  assert(roundTrip.youtubeId === "BI0ZwJiqYk8", "roundtrip youtube id");
  assert(
    roundTrip.videoStartedAtMs === meta.creationTimeMs,
    "roundtrip started",
  );

  // Legacy mp4 rows are not playable in the YouTube-only UI.
  const legacyMp4 = resolveMp4Playback({
    id: "legacy",
    provider: "mp4",
    offsetSec: 0,
    syncSource: "unsynced",
    objectKey: "sessions/x/video.mp4",
  });
  assert(legacyMp4.src != null, "legacy download url still resolvable");

  // --- dual compare uses each side's YouTube offset at lap start ---
  const lap = lapAsSyncLap({
    id: "l1",
    lap_number: 1,
    lap_time_ms: 120_000,
    start_offset_sec: 0,
    telemetry: points,
  });
  const sideA: DualVideoSide = {
    lap,
    video: {
      ...video,
      offsetSec: 10,
      youtubeId: "abcdefghijk",
    },
    label: "A",
  };
  const sideB: DualVideoSide = {
    lap,
    video: {
      ...video,
      id: "v2",
      offsetSec: 3.5,
      youtubeId: "BI0ZwJiqYk8",
    },
    label: "B",
  };
  const aligned = dualCompareAlignedAtLapStart(sideA, sideB);
  assert(aligned.refVideoTime === 10, `ref @ lap start ${aligned.refVideoTime}`);
  assert(
    aligned.otherVideoTime === 3.5,
    `other @ lap start ${aligned.otherVideoTime}`,
  );
  assert(dualVideoTimeAtProgress(sideA, 0) === 10, "progress 0 = offset");

  console.log("verify-video-gps-sync ok", {
    suggested,
    brakeT,
    straightT,
    aligned,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
