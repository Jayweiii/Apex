"use client";

import {
  formatOffsetReadout,
  guessOffsetFromClipLength,
  isVideoSynced,
  syncBadgeForVideo,
  syncGuideStepForVideo,
  type SyncGuideStep,
} from "@/lib/video-sync-guide";
import { offsetForLapStart } from "@/lib/video-sync";
import { formatClock } from "@/lib/format";
import type { SessionVideo } from "@/lib/types";
import { parseYouTubeId } from "@/lib/youtube";
import { useEffect, useMemo, useRef, useState } from "react";

const FRAME = 1 / 30;
const NUDGE = 0.1;

const STEPS: Array<{ id: SyncGuideStep; label: string }> = [
  { id: 1, label: "Paste link" },
  { id: 2, label: "Mark start" },
  { id: 3, label: "Check sync" },
  { id: 4, label: "Saved" },
];

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
 * Guided, compact YouTube ↔ lap sync flow for the session page.
 * Steps: paste → mark start line → check → auto-save confirmation.
 */
export function LapVideoSyncGuide({
  video,
  videoTime,
  lapStartOffsetSec,
  lapTimeMs,
  lapNumber,
  durationSec,
  canEdit = false,
  onChange,
  onSeek,
  onAttachYouTube,
  onPlayBoth,
}: {
  video: SessionVideo | null;
  videoTime: number;
  lapStartOffsetSec: number;
  lapTimeMs: number;
  lapNumber?: number;
  /** Clip duration when known (catalog / metadata) for Auto-guess. */
  durationSec?: number | null;
  canEdit?: boolean;
  onChange?: (next: SessionVideo) => void;
  onSeek?: (videoTime: number) => void;
  /** Paste + attach a YouTube URL for this lap (step 1). */
  onAttachYouTube?: (input: {
    youtubeId: string;
    youtubeUrl: string;
    title: string;
  }) => void | Promise<void>;
  /** Start lockstep playback so map/charts and video move together. */
  onPlayBoth?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<SessionVideo[]>([]);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasClip = Boolean(
    video && (video.youtubeId || video.provider === "mp4"),
  );
  const synced = isVideoSynced(video);
  const badge = syncBadgeForVideo(video);
  const activeStep: SyncGuideStep = savedFlash
    ? 4
    : syncGuideStepForVideo(video);

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

  function markStartLineHere() {
    if (!video || !onChange) return;
    const offsetSec = offsetForLapStart(videoTime, lapStartOffsetSec);
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
      aria-label="Video sync guide"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
              Sync this lap
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
                  ? "Start line is aligned to telemetry"
                  : "Paste a link and mark the start/finish crossing"
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
              Align the onboard so start/finish matches the GPS lap.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setHelpOpen((v) => !v)}
            className="min-h-8 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            title="Short overview of how video sync works"
          >
            How syncing works
          </button>
          {canEdit && undoStack.length ? (
            <button
              type="button"
              onClick={undo}
              className="min-h-8 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              title="Undo last sync change"
            >
              Undo
            </button>
          ) : null}
          {canEdit && hasClip ? (
            <button
              type="button"
              onClick={resetSync}
              className="min-h-8 rounded-md border border-zinc-800 px-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
              title="Clear sync and start over"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {helpOpen ? (
        <div className="mt-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-xs leading-relaxed text-zinc-400">
          <p>
            The GPS lap starts at the start/finish line. Pause the onboard on
            that exact crossing, click{" "}
            <span className="text-zinc-200">Mark start line here</span>, then
            play map + video together to confirm. Offset saves automatically for
            you and friends.
          </p>
          <p className="mt-1.5">
            Tip: frame-step with the nudge buttons beside the mark control.
            Auto-guess estimates from clip length vs lap time when duration is
            known.
          </p>
        </div>
      ) : null}

      <ol className="mt-3 flex flex-wrap gap-1.5" aria-label="Sync steps">
        {STEPS.map((step) => {
          const done =
            step.id < activeStep || (step.id === 4 && savedFlash) ||
            (step.id === 1 && hasClip) ||
            (step.id === 2 && synced) ||
            (step.id === 3 && synced);
          const current = step.id === activeStep;
          return (
            <li
              key={step.id}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${
                current
                  ? "bg-orange-500/20 text-orange-200 ring-1 ring-orange-500/40"
                  : done
                    ? "bg-zinc-800/80 text-zinc-300"
                    : "bg-zinc-950 text-zinc-600 ring-1 ring-zinc-800"
              }`}
            >
              <span className="font-mono text-[10px] opacity-70">{step.id}</span>
              {step.label}
            </li>
          );
        })}
      </ol>

      {/* Step 1 — paste */}
      {canEdit && onAttachYouTube ? (
        <div
          className={`mt-3 space-y-2 ${activeStep === 1 ? "" : "opacity-90"}`}
        >
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            1 · Paste YouTube link
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
        </div>
      ) : null}

      {/* Step 2 — mark start */}
      {hasClip && canEdit && onChange ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            2 · Find the start line
          </p>
          <p className="text-xs text-zinc-500">
            Pause on the exact start/finish crossing, then mark. Use frame-step
            or ±0.1s to land on the line.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={markStartLineHere}
              className="min-h-12 rounded-lg bg-orange-500 px-5 text-sm font-semibold text-black hover:bg-orange-400"
              title="Set offset so this paused frame is lap start (SF)"
            >
              Mark start line here
            </button>
            <span className="font-mono text-xs text-zinc-500">
              @ {formatClock(videoTime)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Frame nudge">
            {[
              { label: "−1s", d: -1, seek: true },
              { label: "−0.1s", d: -NUDGE, seek: true },
              { label: "−1f", d: -FRAME, seek: true },
              { label: "+1f", d: FRAME, seek: true },
              { label: "+0.1s", d: NUDGE, seek: true },
              { label: "+1s", d: 1, seek: true },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => nudgeVideo(item.d)}
                className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-300 hover:border-zinc-600"
                title={`Seek video ${item.label}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={autoGuess}
              className="min-h-9 rounded-md border border-zinc-700 px-3 text-xs text-zinc-300 hover:border-zinc-500"
              title="Estimate offset from clip length vs lap time, then fine-tune"
            >
              Auto-guess
            </button>
            <button
              type="button"
              onClick={() => nudgeOffset(-NUDGE)}
              className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-400 hover:border-zinc-600"
              title="Shift sync earlier by 0.1s"
            >
              Sync −0.1s
            </button>
            <button
              type="button"
              onClick={() => nudgeOffset(NUDGE)}
              className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-400 hover:border-zinc-600"
              title="Shift sync later by 0.1s"
            >
              Sync +0.1s
            </button>
          </div>
        </div>
      ) : null}

      {/* Step 3 — check */}
      {hasClip ? (
        <div className="mt-4 space-y-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            3 · Check the sync
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
            <span
              className={`inline-flex min-h-8 items-center rounded-md px-2 text-xs uppercase tracking-[0.12em] ${
                synced
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-zinc-800 text-zinc-500"
              }`}
            >
              {badge.label}
            </span>
            {offsetReadout ? (
              <span className="font-mono text-sm text-zinc-200">
                {offsetReadout}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-zinc-600">
            Watch the car on the map hit SF as the video crosses the line. Nudge
            Sync ±0.1s if it&apos;s early or late — changes save automatically.
          </p>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
