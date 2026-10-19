"use client";

import {
  formatOffsetReadout,
  guessOffsetFromClipLength,
  isVideoSynced,
  offsetFromPointMatch,
  SYNC_GUIDE_STEPS,
  syncBadgeForVideo,
  syncGuideStepForVideo,
  type SyncGuideStep,
} from "@/lib/video-sync-guide";
import { formatClock } from "@/lib/format";
import type { SessionVideo } from "@/lib/types";
import { parseYouTubeId } from "@/lib/youtube";
import { useEffect, useMemo, useRef, useState } from "react";

const FRAME = 1 / 30;
const NUDGE = 0.1;

async function fetchOEmbedTitle(id: string, fallback: string): Promise<string> {
  try {
    const res = await fetch(
      `/api/youtube/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { title?: string };
      if (json.title) return json.title;
    }
  } catch {
    // offline / blocked
  }
  return fallback;
}

/**
 * Jason's point-matching sync stepper.
 *
 * 1) Pick lap + paste YouTube
 * 2) Click a moment on the speed chart (pins telemetry time)
 * 3) Pause video at that same moment (YouTube stays independent until Synced)
 * 4) Sync here → offset = videoTime − telemetrySessionTime
 *
 * Keeps ±0.1s, frame-step, Auto-guess, Synced/Not synced, Saved, Reset.
 * After sync, parent enables two-way playback.
 */
export function LapVideoSyncGuide({
  video,
  videoTime,
  lapStartOffsetSec,
  lapTimeMs,
  lapNumber,
  chartLapTimeSec,
  durationSec,
  canEdit = false,
  sessionLevel = false,
  onChange,
  onSeek,
  onAttachYouTube,
  onPlayBoth,
  onStartsAtLapChange,
  startsAtLapNumber,
  availableLaps,
}: {
  video: SessionVideo | null;
  videoTime: number;
  lapStartOffsetSec: number;
  lapTimeMs: number;
  lapNumber?: number;
  /** Current telemetry pin as lap-relative seconds (from chart/map). */
  chartLapTimeSec?: number | null;
  /** Clip duration when known (catalog / metadata) for Auto-guess. */
  durationSec?: number | null;
  canEdit?: boolean;
  /** Session-level clip (lapId null) — offset applies at each lap start. */
  sessionLevel?: boolean;
  onChange?: (next: SessionVideo) => void;
  onSeek?: (videoTime: number) => void;
  onAttachYouTube?: (input: {
    youtubeId: string;
    youtubeUrl: string;
    title: string;
  }) => void | Promise<void>;
  /** Start lockstep playback (only meaningful after Synced). */
  onPlayBoth?: () => void;
  /** Rebind session-level video to "starts at lap N". */
  onStartsAtLapChange?: (lapNumber: number) => void;
  startsAtLapNumber?: number | null;
  availableLaps?: Array<{ lap_number: number; lap_time_ms: number }>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<SessionVideo[]>([]);
  /** Sticky pin: last chart time the user scrubbed to during setup. */
  const [pinnedLapTime, setPinnedLapTime] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasClip = Boolean(
    video && (video.youtubeId || video.provider === "mp4"),
  );
  const synced = isVideoSynced(video);
  const badge = syncBadgeForVideo(video);

  useEffect(() => {
    if (chartLapTimeSec == null || !Number.isFinite(chartLapTimeSec)) return;
    setPinnedLapTime(chartLapTimeSec);
  }, [chartLapTimeSec]);

  const telemetryPinned = pinnedLapTime != null;
  const activeStep: SyncGuideStep = syncGuideStepForVideo(video, {
    telemetryPinned,
    justSaved: savedFlash,
  });

  const pinSessionTime =
    pinnedLapTime != null
      ? lapStartOffsetSec + pinnedLapTime
      : null;

  const offsetReadout = useMemo(() => {
    if (!video) return null;
    return formatOffsetReadout(video.offsetSec, lapStartOffsetSec);
  }, [video, lapStartOffsetSec]);

  const clipDuration = durationSec ?? null;

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  function flashSaved() {
    setSavedFlash(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedFlash(false), 2200);
  }

  function pushUndo(prev: SessionVideo) {
    setUndoStack((stack) => [...stack.slice(-7), prev]);
  }

  function save(next: SessionVideo) {
    if (!onChange) return;
    if (video) pushUndo(video);
    onChange(next);
    flashSaved();
  }

  function syncHere() {
    if (!video || !onChange) return;
    if (pinSessionTime == null) {
      setError("Click the speed chart or map to pin a telemetry moment first");
      return;
    }
    setError(null);
    const offsetSec = offsetFromPointMatch(videoTime, pinSessionTime);
    save({ ...video, offsetSec, syncSource: "manual" });
  }

  function nudgeVideo(delta: number) {
    if (!onSeek) return;
    const next = Math.max(0, videoTime + delta);
    onSeek(next);
  }

  function nudgeOffset(delta: number) {
    if (!video || !onChange) return;
    save({
      ...video,
      offsetSec: video.offsetSec + delta,
      syncSource: "manual",
    });
    onSeek?.(videoTime);
  }

  function autoGuess() {
    if (!video || !onChange) return;
    const guessed = guessOffsetFromClipLength(
      clipDuration,
      lapTimeMs,
      lapStartOffsetSec,
    );
    if (guessed == null) {
      setError(
        "Need clip duration to auto-guess — paste a catalog match or nudge manually.",
      );
      return;
    }
    setError(null);
    save({ ...video, offsetSec: guessed, syncSource: "auto" });
    onSeek?.(guessed + lapStartOffsetSec);
  }

  function undo() {
    const prev = undoStack[undoStack.length - 1];
    if (!prev || !onChange) return;
    setUndoStack((stack) => stack.slice(0, -1));
    onChange(prev);
    flashSaved();
  }

  function resetSync() {
    if (!video || !onChange) return;
    pushUndo(video);
    onChange({ ...video, offsetSec: 0, syncSource: "unsynced", rate: 1 });
    setPinnedLapTime(null);
    setError(null);
  }

  async function attach() {
    if (!onAttachYouTube) return;
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) {
      setError("Paste a YouTube watch / youtu.be / shorts URL or 11-char id");
      return;
    }
    setBusy(true);
    try {
      const title = await fetchOEmbedTitle(id, url.trim());
      await onAttachYouTube({
        youtubeId: id,
        youtubeUrl: url.trim(),
        title,
      });
      setUrl("");
      flashSaved();
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit && !hasClip) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950/50 px-4 py-3 text-sm text-zinc-500">
        No YouTube onboard for this lap yet.
      </div>
    );
  }

  return (
    <section
      className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-3 sm:p-4"
      aria-label="Point-match video sync"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Point-match sync
              {lapNumber != null ? ` · L${lapNumber}` : ""}
            </p>
            <span
              className={`inline-flex min-h-6 items-center rounded-md px-2 text-[11px] font-medium uppercase tracking-[0.12em] ${
                badge.synced
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-zinc-800 text-zinc-400"
              }`}
              title={
                badge.synced
                  ? "Video and telemetry are locked together"
                  : "Match a chart moment to a paused video frame"
              }
            >
              {badge.label}
            </span>
            {savedFlash ? (
              <span
                className="inline-flex min-h-6 items-center rounded-md bg-orange-500/20 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-300"
                role="status"
              >
                Saved
              </span>
            ) : null}
          </div>
          {offsetReadout && hasClip ? (
            <p className="mt-1 font-mono text-sm text-zinc-200">
              {offsetReadout}
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              Pin a chart moment, pause the matching video frame, then Sync here.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className="min-h-8 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
          >
            How syncing works
          </button>
          {canEdit && undoStack.length ? (
            <button
              type="button"
              onClick={undo}
              className="min-h-8 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              Undo
            </button>
          ) : null}
          {canEdit && hasClip ? (
            <button
              type="button"
              onClick={resetSync}
              className="min-h-8 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {helpOpen ? (
        <div className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs leading-relaxed text-zinc-400">
          <p>
            Click or scrub the speed chart / map to pin a telemetry time. Pause
            the YouTube player on the matching visual moment (they stay
            independent until you sync).{" "}
            <span className="text-zinc-200">Sync here</span> saves{" "}
            <span className="font-mono text-zinc-300">
              offset = video − telemetry
            </span>
            . After that, map and video play together.
          </p>
          <p className="mt-1.5">
            Session-level clips: set “This video starts at lap N” so the same
            offset applies at each lap start via start_offset_sec.
          </p>
        </div>
      ) : null}

      <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Sync steps">
        {SYNC_GUIDE_STEPS.map((step) => {
          const done =
            step.id < activeStep ||
            (step.id === 1 && hasClip) ||
            (step.id === 2 && telemetryPinned) ||
            (step.id === 4 && synced);
          const current = step.id === activeStep;
          return (
            <li
              key={step.id}
              className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md px-2.5 text-xs ${
                current
                  ? "bg-orange-500/20 text-orange-200 ring-1 ring-orange-500/40"
                  : done
                    ? "bg-zinc-800/80 text-zinc-300"
                    : "bg-zinc-950 text-zinc-600 ring-1 ring-zinc-800"
              }`}
            >
              <span className="font-mono text-[10px] opacity-70">{step.id}</span>
              <span className="truncate">{step.label}</span>
            </li>
          );
        })}
      </ol>

      {/* Step 1 — pick lap + paste */}
      {canEdit && onAttachYouTube ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            1 · Pick lap + paste YouTube
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtu.be/…"
              className="min-h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
              aria-label="YouTube URL"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void attach()}
              className="min-h-11 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
            >
              {busy ? "…" : hasClip ? "Replace" : "Add video"}
            </button>
          </div>
          {hasClip && video?.title ? (
            <p className="truncate text-xs text-zinc-500">
              Current: {video.title}
            </p>
          ) : null}
          {sessionLevel && availableLaps?.length && onStartsAtLapChange ? (
            <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              This video starts at lap
              <select
                value={startsAtLapNumber ?? availableLaps[0]?.lap_number ?? 1}
                onChange={(e) =>
                  onStartsAtLapChange(Number(e.target.value))
                }
                className="min-h-9 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200"
              >
                {availableLaps.map((lap) => (
                  <option key={lap.lap_number} value={lap.lap_number}>
                    {lap.lap_number}
                  </option>
                ))}
              </select>
              <span className="text-zinc-600">
                (offset applies at each lap start)
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      {/* Steps 2–4 — point match */}
      {hasClip && canEdit && onChange ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              2 · Click a moment on the speed chart
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Scrub or click the chart / map — the cursor pins telemetry time.
              Video stays free until you sync.
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-400">
              Pin{" "}
              {pinSessionTime != null
                ? `session ${formatClock(pinSessionTime)} (lap ${formatClock(pinnedLapTime!)})`
                : "— click chart —"}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              3 · Pause video at that same moment
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Use the player or frame-step below. Current video{" "}
              <span className="font-mono text-zinc-300">
                {formatClock(videoTime)}
              </span>
            </p>
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              aria-label="Frame nudge"
            >
              {[
                { label: "−1s", d: -1 },
                { label: "−0.1s", d: -NUDGE },
                { label: "−1f", d: -FRAME },
                { label: "+1f", d: FRAME },
                { label: "+0.1s", d: NUDGE },
                { label: "+1s", d: 1 },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => nudgeVideo(item.d)}
                  className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-300 hover:border-zinc-600"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
              4 · Sync here
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={syncHere}
                disabled={pinSessionTime == null}
                className="min-h-12 rounded-lg bg-orange-500 px-5 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
                title="offset = videoTime − telemetryTime"
              >
                Sync here
              </button>
              <button
                type="button"
                onClick={autoGuess}
                className="min-h-9 rounded-md border border-zinc-700 px-3 text-xs text-zinc-300 hover:border-zinc-500"
              >
                Auto-guess
              </button>
              <button
                type="button"
                onClick={() => nudgeOffset(-NUDGE)}
                className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-400 hover:border-zinc-600"
              >
                −0.1s
              </button>
              <button
                type="button"
                onClick={() => nudgeOffset(NUDGE)}
                className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-400 hover:border-zinc-600"
              >
                +0.1s
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* After sync — two-way play */}
      {hasClip && synced ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            Two-way playback
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {onPlayBoth ? (
              <button
                type="button"
                onClick={onPlayBoth}
                className="min-h-10 rounded-lg border border-orange-500/40 px-4 text-sm font-medium text-orange-300 hover:border-orange-400"
              >
                Play map + video
              </button>
            ) : null}
            <span className="font-mono text-sm text-zinc-200">
              {offsetReadout}
            </span>
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
