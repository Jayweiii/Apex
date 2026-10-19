"use client";

import { Mp4Player } from "@/components/video/Mp4Player";
import { YouTubePlayer } from "@/components/video/YouTubePlayer";
import type { VideoPlayerHandle } from "@/components/video/useVideoSync";
import {
  advanceSharedProgress,
  dualVideoTimeAtProgress,
  sideHasPlayableVideo,
  sideHasVideoMeta,
  type DualVideoSide,
} from "@/lib/dual-video-sync";
import { formatClock, formatLapTime } from "@/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";

function SidePlayer({
  side,
  color,
  onBind,
}: {
  side: DualVideoSide;
  color: string;
  onBind: (handle: VideoPlayerHandle | null) => void;
}) {
  if (!sideHasPlayableVideo(side)) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/80 px-3 text-center text-sm text-zinc-500">
        {side.needsLocalFile || side.video?.provider === "mp4" ? (
          <>
            <span className="text-zinc-300">
              Local-only video for {side.label}
            </span>
            <span className="text-xs text-zinc-600">
              Offset{" "}
              {side.video != null
                ? `${side.video.offsetSec.toFixed(1)}s`
                : "—"}{" "}
              is saved — attach the MP4 on this device (or open a session with
              R2) to play in lockstep.
            </span>
          </>
        ) : (
          <span>No video for {side.label}</span>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: color }}
        />
        {side.label}
        <span className="font-mono normal-case tracking-normal text-zinc-400">
          {formatLapTime(side.lap.lapTimeMs)}
        </span>
      </div>
      {side.video?.provider === "youtube" && side.video.youtubeId ? (
        <YouTubePlayer
          key={side.video.youtubeId}
          videoId={side.video.youtubeId}
          ref={(instance) => onBind(instance)}
        />
      ) : side.mp4Src ? (
        <Mp4Player src={side.mp4Src} ref={(instance) => onBind(instance)} />
      ) : null}
    </div>
  );
}

/**
 * Two onboard videos lockstepped by shared lap-relative progress (0..1).
 * Play/pause/scrub here drive both players; parent map/charts share `progress`.
 */
export function DualSessionVideos({
  refSide,
  otherSide,
  progress,
  onProgress,
}: {
  refSide: DualVideoSide;
  otherSide: DualVideoSide;
  progress: number | null;
  onProgress: (next: number | null) => void;
}) {
  const refPlayer = useRef<VideoPlayerHandle | null>(null);
  const otherPlayer = useRef<VideoPlayerHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(progress ?? 0);
  progressRef.current = progress ?? 0;

  const seekBoth = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      const refT = dualVideoTimeAtProgress(refSide, clamped);
      const otherT = dualVideoTimeAtProgress(otherSide, clamped);
      if (refT != null) refPlayer.current?.seek(refT);
      if (otherT != null) otherPlayer.current?.seek(otherT);
    },
    [refSide, otherSide],
  );

  // Scrub from parent (map/charts) → both videos.
  useEffect(() => {
    if (progress == null) return;
    seekBoth(progress);
  }, [progress, seekBoth]);

  // Master clock while playing.
  useEffect(() => {
    if (!playing) {
      refPlayer.current?.pause();
      otherPlayer.current?.pause();
      return;
    }
    // Keep native players paused — we own the timeline via seek.
    refPlayer.current?.pause();
    otherPlayer.current?.pause();
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      const next = advanceSharedProgress(
        progressRef.current,
        dt,
        refSide.lap.lapTimeMs,
        otherSide.lap.lapTimeMs,
      );
      progressRef.current = next;
      onProgress(next);
      seekBoth(next);
      if (next >= 1) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onProgress, seekBoth, refSide.lap.lapTimeMs, otherSide.lap.lapTimeMs]);

  const sharedMs = Math.min(refSide.lap.lapTimeMs, otherSide.lap.lapTimeMs);
  const lapTimeSec = ((progress ?? 0) * sharedMs) / 1000;
  const canPlay =
    sideHasPlayableVideo(refSide) || sideHasPlayableVideo(otherSide);
  const hasMeta = sideHasVideoMeta(refSide) || sideHasVideoMeta(otherSide);

  if (!canPlay && !hasMeta) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Dual onboard · lap-relative sync
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Shared cursor from lap start — play/pause/scrub both sessions
            together.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!canPlay}
            onClick={() => {
              const at = progress ?? 0;
              if (at >= 1) onProgress(0);
              setPlaying((p) => !p);
            }}
            className="min-h-10 rounded-lg bg-orange-500 px-3 py-2 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
          >
            {playing ? "Pause" : "Play both"}
          </button>
          <span className="font-mono text-sm text-zinc-300">
            {formatClock(lapTimeSec)}
            <span className="text-zinc-600">
              {" "}
              / {formatClock(sharedMs / 1000)}
            </span>
          </span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <SidePlayer
          side={refSide}
          color="#f97316"
          onBind={(h) => {
            refPlayer.current = h;
          }}
        />
        <SidePlayer
          side={otherSide}
          color="#38bdf8"
          onBind={(h) => {
            otherPlayer.current = h;
          }}
        />
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-zinc-500">Scrub (lap-relative)</span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round((progress ?? 0) * 1000)}
          onChange={(event) => {
            setPlaying(false);
            const next = Number(event.target.value) / 1000;
            onProgress(next);
            seekBoth(next);
          }}
          className="w-full accent-orange-500"
        />
      </label>
    </div>
  );
}
