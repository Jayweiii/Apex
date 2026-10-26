import type { ParsedLap, SessionVideo, TelemetryPoint } from "./types";

export type SyncLap = {
  id?: string;
  lapNumber: number;
  lapTimeMs: number;
  startOffsetSec: number;
  points: TelemetryPoint[];
};

export type SessionCursor = {
  sessionTime: number;
  lap: SyncLap | null;
  lapTime: number;
  pointIndex: number;
  point: TelemetryPoint | null;
};

/** videoTime = offsetSec + rate * sessionTime */
export function videoTimeFromSession(
  sessionTime: number,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
) {
  const rate = video.rate && video.rate > 0 ? video.rate : 1;
  return video.offsetSec + rate * sessionTime;
}

/** sessionTime = (videoTime - offsetSec) / rate */
export function sessionTimeFromVideo(
  videoTime: number,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
) {
  const rate = video.rate && video.rate > 0 ? video.rate : 1;
  return (videoTime - video.offsetSec) / rate;
}

export function sessionTimeForLapPoint(
  lap: Pick<SyncLap, "startOffsetSec">,
  lapTimeSec: number,
) {
  return lap.startOffsetSec + lapTimeSec;
}

export function findLapAtSessionTime(
  laps: SyncLap[],
  sessionTime: number,
): SyncLap | null {
  if (!laps.length) return null;
  const sorted = [...laps].sort((a, b) => a.startOffsetSec - b.startOffsetSec);
  for (let i = 0; i < sorted.length; i += 1) {
    const lap = sorted[i];
    const end = lap.startOffsetSec + lap.lapTimeMs / 1000;
    if (sessionTime >= lap.startOffsetSec && sessionTime < end) return lap;
    if (i === sorted.length - 1 && sessionTime >= lap.startOffsetSec) return lap;
  }
  if (sessionTime < sorted[0].startOffsetSec) return sorted[0];
  return sorted[sorted.length - 1];
}

export function interpolatePoint(
  points: TelemetryPoint[],
  lapTimeSec: number,
): { point: TelemetryPoint | null; index: number } {
  if (!points.length) return { point: null, index: 0 };
  if (lapTimeSec <= points[0].t) return { point: points[0], index: 0 };
  const last = points[points.length - 1];
  if (lapTimeSec >= last.t) {
    return { point: last, index: points.length - 1 };
  }
  let hi = 1;
  while (hi < points.length && points[hi].t < lapTimeSec) hi += 1;
  const right = points[hi] ?? last;
  const left = points[hi - 1] ?? points[0];
  const span = right.t - left.t;
  const mix = span === 0 ? 0 : (lapTimeSec - left.t) / span;
  const point: TelemetryPoint = {
    t: lapTimeSec,
    speed: left.speed + (right.speed - left.speed) * mix,
  };
  if (left.lat != null && right.lat != null) {
    point.lat = left.lat + (right.lat - left.lat) * mix;
  }
  if (left.lon != null && right.lon != null) {
    point.lon = left.lon + (right.lon - left.lon) * mix;
  }
  if (left.latG != null && right.latG != null) {
    point.latG = left.latG + (right.latG - left.latG) * mix;
  }
  if (left.lonG != null && right.lonG != null) {
    point.lonG = left.lonG + (right.lonG - left.lonG) * mix;
  }
  if (left.g != null && right.g != null) {
    point.g = left.g + (right.g - left.g) * mix;
  }
  return { point, index: hi - 1 + mix };
}

export function cursorFromVideoTime(
  videoTime: number,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
  laps: SyncLap[],
): SessionCursor {
  const sessionTime = sessionTimeFromVideo(videoTime, video);
  const lap = findLapAtSessionTime(laps, sessionTime);
  if (!lap) {
    return {
      sessionTime,
      lap: null,
      lapTime: 0,
      pointIndex: 0,
      point: null,
    };
  }
  const lapTime = Math.max(0, sessionTime - lap.startOffsetSec);
  const { point, index } = interpolatePoint(lap.points, lapTime);
  return {
    sessionTime,
    lap,
    lapTime,
    pointIndex: index,
    point,
  };
}

export function videoTimeFromLapProgress(
  lap: SyncLap,
  progress: number,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
) {
  // Shared time base: progress × lap_time_ms (not last sample t / index).
  const durationSec = Math.max(0.001, lap.lapTimeMs / 1000);
  const lapTime = Math.max(0, Math.min(1, progress)) * durationSec;
  return videoTimeFromSession(sessionTimeForLapPoint(lap, lapTime), video);
}

/** Inverse of videoTimeFromLapProgress — lap progress from a video clock. */
export function lapProgressFromVideoTime(
  lap: SyncLap,
  videoTime: number,
  video: Pick<SessionVideo, "offsetSec" | "rate">,
) {
  const sessionTime = sessionTimeFromVideo(videoTime, video);
  const durationSec = Math.max(0.001, lap.lapTimeMs / 1000);
  const lapTime = Math.max(0, sessionTime - lap.startOffsetSec);
  return Math.max(0, Math.min(1, lapTime / durationSec));
}

export function suggestOffsetFromClocks(
  videoTime: number,
  clockAtFrameMs: number,
  sessionStartedAtMs: number,
) {
  return videoTime - (clockAtFrameMs - sessionStartedAtMs) / 1000;
}

export function suggestOffsetFromVideoStart(
  videoStartedAtMs: number,
  sessionStartedAtMs: number,
) {
  return (videoStartedAtMs - sessionStartedAtMs) / 1000;
}

/** Mark S/F: offset so this video frame aligns with lap start. */
export function offsetForLapStart(
  videoTime: number,
  lapStartOffsetSec: number,
) {
  return videoTime - lapStartOffsetSec;
}

export function toSyncLaps(
  laps: Array<{
    id?: string;
    lap_number?: number;
    lapNumber?: number;
    lap_time_ms?: number;
    lapTimeMs?: number;
    start_offset_sec?: number | null;
    startOffsetSec?: number;
    telemetry?: TelemetryPoint[];
    points?: TelemetryPoint[];
  }>,
): SyncLap[] {
  let running = 0;
  return laps.map((lap, index) => {
    const startOffsetSec =
      lap.start_offset_sec ??
      lap.startOffsetSec ??
      running;
    const lapTimeMs = lap.lap_time_ms ?? lap.lapTimeMs ?? 0;
    running = startOffsetSec + lapTimeMs / 1000;
    return {
      id: lap.id,
      lapNumber: lap.lap_number ?? lap.lapNumber ?? index + 1,
      lapTimeMs,
      startOffsetSec,
      points: lap.telemetry ?? lap.points ?? [],
    };
  });
}

export function fromParsedLaps(laps: ParsedLap[]): SyncLap[] {
  return toSyncLaps(
    laps.map((lap) => ({
      lapNumber: lap.lapNumber,
      lapTimeMs: lap.lapTimeMs,
      startOffsetSec: lap.startOffsetSec,
      points: lap.points,
    })),
  );
}
