"use client";

import {
  offsetForLapStart,
  suggestOffsetFromClocks,
  suggestOffsetFromVideoStart,
} from "@/lib/video-sync";
import {
  findSyncEventLapTime,
  offsetForSessionMoment,
  sessionTimeForLapEvent,
  SYNC_EVENT_LABELS,
  type SyncEventKind,
} from "@/lib/sync-events";
import {
  predictNextCrossing,
  solveLapSequence,
  type LoggedLapStart,
} from "@/lib/lap-estimator";
import type { SessionVideo, TelemetryPoint } from "@/lib/types";
import { formatClock, formatLapTime } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";

const FRAME = 1 / 30;

export function SyncPanel({
  video,
  videoTime,
  lapStartOffsetSec,
  lapTimeMs,
  sessionStartedAtMs,
  loggedLaps,
  chartLapTimeSec,
  lapPoints,
  onChange,
  onSeek,
  onSeekChartLapTime,
}: {
  video: SessionVideo;
  videoTime: number;
  lapStartOffsetSec: number;
  lapTimeMs: number;
  sessionStartedAtMs?: number;
  loggedLaps: LoggedLapStart[];
  /** Current chart/map cursor as lap-relative seconds (independent when Follow is off). */
  chartLapTimeSec?: number | null;
  lapPoints?: TelemetryPoint[];
  onChange: (next: SessionVideo) => void;
  onSeek?: (videoTime: number) => void;
  /** Jump chart/map to a lap-relative time (for snap-to-event). */
  onSeekChartLapTime?: (lapTimeSec: number) => void;
}) {
  const [markTimes, setMarkTimes] = useState<number[]>([]);
  const [clockInput, setClockInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [videoMark, setVideoMark] = useState<number | null>(null);
  const [chartMark, setChartMark] = useState<number | null>(null);

  const suggestedTod =
    video.videoStartedAtMs != null && sessionStartedAtMs != null
      ? suggestOffsetFromVideoStart(video.videoStartedAtMs, sessionStartedAtMs)
      : null;

  const chartSessionTime =
    chartLapTimeSec != null
      ? sessionTimeForLapEvent(lapStartOffsetSec, chartLapTimeSec)
      : null;

  const estimator = useMemo(() => {
    if (markTimes.length < 2) return null;
    return solveLapSequence(markTimes, loggedLaps);
  }, [markTimes, loggedLaps]);

  const nextPredict =
    markTimes.length >= 2
      ? predictNextCrossing(markTimes, loggedLaps)
      : null;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "," || event.key === "<") {
        event.preventDefault();
        nudge(event.shiftKey ? -1 : -FRAME);
      } else if (event.key === "." || event.key === ">") {
        event.preventDefault();
        nudge(event.shiftKey ? 1 : FRAME);
      } else if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        markCrossing();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, videoTime, lapStartOffsetSec, lapTimeMs, markTimes]);

  function save(patch: Partial<SessionVideo>) {
    onChange({ ...video, ...patch });
    setMessage("Saved sync");
  }

  function nudge(delta: number) {
    const next = {
      ...video,
      offsetSec: video.offsetSec + delta,
      syncSource: "manual" as const,
    };
    onChange(next);
    onSeek?.(videoTime);
  }

  function markCrossing() {
    const nextMarks = [...markTimes, videoTime].slice(-8);
    setMarkTimes(nextMarks);

    if (nextMarks.length === 1) {
      const offsetSec = offsetForLapStart(videoTime, lapStartOffsetSec);
      save({ offsetSec, syncSource: "manual" });
      setMessage(
        `Marked start @ ${formatClock(videoTime)}. Play to finish and mark again.`,
      );
      return;
    }

    const measured = nextMarks[nextMarks.length - 1] - nextMarks[nextMarks.length - 2];
    const logged = lapTimeMs / 1000;
    const delta = measured - logged;
    if (Math.abs(delta) < 0.3) {
      setMessage(
        `Measured ${formatClock(measured)} vs logged ${formatLapTime(lapTimeMs)} (Δ ${delta.toFixed(2)}s) — good.`,
      );
    } else {
      setMessage(
        `Measured ${formatClock(measured)} vs logged ${formatLapTime(lapTimeMs)} (Δ ${delta.toFixed(2)}s). Try another lap or nudge.`,
      );
    }

    const solved = solveLapSequence(nextMarks, loggedLaps);
    if (solved) {
      save({
        offsetSec: solved.offsetSec,
        rate: solved.rate,
        syncSource: "auto",
      });
      setMessage(
        (message) =>
          `${message ?? ""} Applied sequence fit (RMS ${solved.rmsErrorSec.toFixed(3)}s).`.trim(),
      );
    }
  }

  function markVideoHere() {
    setVideoMark(videoTime);
    setMessage(`Video mark @ ${formatClock(videoTime)}`);
  }

  function markChartHere() {
    if (chartLapTimeSec == null) {
      setMessage("Scrub the map or speed chart first");
      return;
    }
    setChartMark(chartLapTimeSec);
    setMessage(`Chart mark @ lap ${formatClock(chartLapTimeSec)}`);
  }

  function applyEventPair(kind: SyncEventKind) {
    const v = videoMark ?? videoTime;
    let lapT = chartMark;
    if (lapT == null && chartLapTimeSec != null) lapT = chartLapTimeSec;
    if (lapT == null && lapPoints?.length) {
      lapT = findSyncEventLapTime(lapPoints, kind);
      if (lapT != null) onSeekChartLapTime?.(lapT);
    }
    if (lapT == null) {
      setMessage(
        "Uncheck Follow scrub, scrub video to the visual event and chart to the matching GPS point, then click again.",
      );
      return;
    }
    const sessionTime = sessionTimeForLapEvent(lapStartOffsetSec, lapT);
    const offsetSec = offsetForSessionMoment(v, sessionTime);
    save({ offsetSec, syncSource: "manual" });
    setMessage(
      `${SYNC_EVENT_LABELS[kind]}: video ${formatClock(v)} ↔ session ${formatClock(sessionTime)} → offset ${offsetSec.toFixed(2)}s`,
    );
  }

  function snapChartToEvent(kind: SyncEventKind) {
    if (!lapPoints?.length) {
      setMessage("No telemetry on this lap");
      return;
    }
    const lapT = findSyncEventLapTime(lapPoints, kind);
    if (lapT == null) {
      setMessage(`Could not detect ${SYNC_EVENT_LABELS[kind]} in telemetry`);
      return;
    }
    setChartMark(lapT);
    onSeekChartLapTime?.(lapT);
    setMessage(
      `Chart snapped to ${SYNC_EVENT_LABELS[kind]} @ ${formatClock(lapT)} — scrub video to match, then Set`,
    );
  }

  function applyClock() {
    if (sessionStartedAtMs == null) {
      setMessage("Session has no startedAt — re-process the CSV to keep UTC Time.");
      return;
    }
    const parts = clockInput.trim().split(":");
    if (parts.length < 2) {
      setMessage("Enter clock as hh:mm:ss or mm:ss");
      return;
    }
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (parts.length === 3) {
      hours = Number(parts[0]);
      minutes = Number(parts[1]);
      seconds = Number(parts[2]);
    } else {
      minutes = Number(parts[0]);
      seconds = Number(parts[1]);
    }
    if (![hours, minutes, seconds].every(Number.isFinite)) {
      setMessage("Could not parse clock time");
      return;
    }
    const local = new Date(sessionStartedAtMs);
    local.setHours(hours, minutes, Math.floor(seconds), Math.round((seconds % 1) * 1000));
    const clockMs = local.getTime();
    const offsetSec = suggestOffsetFromClocks(videoTime, clockMs, sessionStartedAtMs);
    save({ offsetSec, syncSource: "time_of_day" });
    setMessage(`Offset from clock → ${offsetSec.toFixed(2)}s`);
  }

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Sync panel
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            offset {video.offsetSec.toFixed(2)}s
            {video.rate && video.rate !== 1 ? ` · rate ${video.rate.toFixed(4)}` : ""}
            {" · "}
            {video.syncSource}
          </p>
        </div>
        <div className="text-right font-mono text-sm text-zinc-300">
          <p>video {formatClock(videoTime)}</p>
          {chartSessionTime != null ? (
            <p className="text-xs text-zinc-500">
              chart session {formatClock(chartSessionTime)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          Event pair (video + chart)
        </p>
        <p className="text-xs text-zinc-600">
          Uncheck Follow scrub. Scrub video to a visual cue and the map/speed
          chart to the matching GPS moment, then set the event — or snap the
          chart to a detected telemetry landmark first.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={markVideoHere}
            className="min-h-10 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600"
          >
            Mark video{videoMark != null ? ` (${formatClock(videoMark)})` : ""}
          </button>
          <button
            type="button"
            onClick={markChartHere}
            className="min-h-10 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600"
          >
            Mark chart
            {chartMark != null ? ` (${formatClock(chartMark)})` : ""}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              "lap_start",
              "straight_start",
              "first_brake",
            ] as SyncEventKind[]
          ).map((kind) => (
            <div key={kind} className="flex gap-1">
              <button
                type="button"
                onClick={() => snapChartToEvent(kind)}
                className="min-h-10 rounded-l-lg border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-zinc-600"
                title={`Snap chart to detected ${SYNC_EVENT_LABELS[kind]}`}
              >
                Snap
              </button>
              <button
                type="button"
                onClick={() => applyEventPair(kind)}
                className="min-h-10 rounded-r-lg bg-orange-500 px-3 text-sm font-semibold text-black hover:bg-orange-400"
              >
                Set {SYNC_EVENT_LABELS[kind]}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={markCrossing}
          className="min-h-10 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600"
        >
          Mark start/finish
        </button>
        {[
          { label: "−1 s", d: -1 },
          { label: "−0.1 s", d: -0.1 },
          { label: "−1 frame", d: -FRAME },
          { label: "+1 frame", d: FRAME },
          { label: "+0.1 s", d: 0.1 },
          { label: "+1 s", d: 1 },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => nudge(item.d)}
            className="min-h-10 rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600"
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-zinc-600">
        Shortcuts: <kbd className="text-zinc-400">,</kbd>/
        <kbd className="text-zinc-400">.</kbd> nudge 1 frame · Shift±1 s ·{" "}
        <kbd className="text-zinc-400">M</kbd> mark crossing
      </p>

      {suggestedTod != null ? (
        <button
          type="button"
          onClick={() =>
            save({ offsetSec: suggestedTod, syncSource: "time_of_day" })
          }
          className="mt-3 block text-sm text-orange-400 hover:text-orange-300"
        >
          Apply suggested offset ({suggestedTod >= 0 ? "+" : ""}
          {suggestedTod.toFixed(1)} s) from video creation_time
        </button>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">Clock at this frame</span>
          <input
            value={clockInput}
            onChange={(e) => setClockInput(e.target.value)}
            placeholder="hh:mm:ss"
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
        </label>
        <button
          type="button"
          onClick={applyClock}
          className="min-h-10 self-end rounded-lg border border-zinc-800 px-3 text-sm text-zinc-300 hover:border-zinc-600"
        >
          Set clock time
        </button>
      </div>

      {markTimes.length ? (
        <p className="mt-3 text-xs text-zinc-500">
          Marks: {markTimes.map((t) => formatClock(t)).join(" → ")}
          {nextPredict != null
            ? ` · next ≈ ${formatClock(nextPredict)}`
            : ""}
          {estimator
            ? ` · fit RMS ${estimator.rmsErrorSec.toFixed(3)}s`
            : ""}
        </p>
      ) : null}
      {message ? <p className="mt-2 text-sm text-zinc-400">{message}</p> : null}
      <p className="mt-3 text-xs text-zinc-600">
        Audio-based sync is planned for a later pass.
      </p>
    </div>
  );
}
