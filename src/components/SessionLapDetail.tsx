"use client";

import { LapCharts } from "@/components/LapCharts";
import { SyncedLapView } from "@/components/video/SyncedLapView";
import { formatLapTime } from "@/lib/format";
import { pickSessionVideoForLap } from "@/lib/pick-session-video";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { useMemo } from "react";

export type SessionLapDetailLap = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  start_offset_sec?: number | null;
  telemetry: TelemetryPoint[];
};

/**
 * In-place lap panel on the session page: map (selected lap only),
 * speed/G charts, delta vs best, and synced YouTube when attached.
 */
export function SessionLapDetail({
  sessionId,
  lap,
  siblingLaps,
  videos,
  videoParam,
  trackId,
  sessionStartedAtMs,
  onVideoChange,
}: {
  sessionId: string;
  lap: SessionLapDetailLap;
  siblingLaps: SessionLapDetailLap[];
  videos: SessionVideo[];
  videoParam?: string | null;
  trackId?: string | null;
  sessionStartedAtMs?: number;
  onVideoChange?: (next: SessionVideo) => void;
}) {
  const points = lap.telemetry;
  const peak = points.reduce((max, point) => Math.max(max, point.speed), 0);
  const bestMs = Math.min(...siblingLaps.map((item) => item.lap_time_ms));
  const deltaSec = (lap.lap_time_ms - bestMs) / 1000;

  const activeVideo: SessionVideo | null = useMemo(
    () =>
      pickSessionVideoForLap(videos, lap.id, {
        videoId: videoParam,
        youtubeOnly: true,
      }),
    [videos, videoParam, lap.id],
  );

  if (!points.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
        No speed samples on this lap.
      </p>
    );
  }

  return (
    <section className="space-y-4" aria-label={`Lap ${lap.lap_number}`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-50">
            Lap {lap.lap_number}
          </h2>
          <p className="mt-0.5 font-mono text-2xl text-orange-400">
            {formatLapTime(lap.lap_time_ms)}
          </p>
        </div>
        <div className="text-sm text-zinc-500">
          <span>Peak {peak.toFixed(0)} km/h</span>
          {deltaSec !== 0 ? (
            <span className="ml-3 font-mono">
              Δ best {deltaSec > 0 ? "+" : ""}
              {deltaSec.toFixed(3)}s
            </span>
          ) : (
            <span className="ml-3 text-orange-500/90">Best</span>
          )}
        </div>
      </div>

      {activeVideo ? (
        <SyncedLapView
          sessionId={sessionId}
          lap={{
            id: lap.id,
            lap_number: lap.lap_number,
            lap_time_ms: lap.lap_time_ms,
            start_offset_sec: lap.start_offset_sec ?? undefined,
            telemetry: points,
          }}
          siblingLaps={siblingLaps.map((item) => ({
            id: item.id,
            lap_number: item.lap_number,
            lap_time_ms: item.lap_time_ms,
            start_offset_sec: item.start_offset_sec ?? undefined,
            telemetry: item.telemetry,
          }))}
          video={activeVideo}
          sessionStartedAtMs={sessionStartedAtMs}
          bestLapMs={bestMs}
          trackId={trackId}
          onVideoChange={onVideoChange}
        />
      ) : (
        <LapCharts
          points={points}
          label={`Lap ${lap.lap_number}`}
          trackId={trackId}
        />
      )}
    </section>
  );
}
