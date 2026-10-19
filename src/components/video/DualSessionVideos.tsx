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

export type MultiVideoSide = DualVideoSide & { color: string };

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
        <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.16em] text-zinc-500">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: color }}
          />
          {side.label}
        </div>
        <span className="text-zinc-300">No YouTube for this lap</span>
        <span className="text-xs text-zinc-600">
          {side.video != null
            ? `Offset ${side.video.offsetSec.toFixed(1)}s is saved — attach a YouTube URL on that session.`
            : "Attach a YouTube onboard on the session page."}
        </span>
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

function gridClass(count: number) {
  if (count <= 1) return "grid gap-3";
  if (count === 2) return "grid gap-3 lg:grid-cols-2";
  // 3–4: 2×2 on desktop; stacked on mobile (swipe via overflow).
  return "grid gap-3 sm:grid-cols-2";
}

/**
 * Up to 4 onboard videos lockstepped by shared lap-relative progress (0..1).
 * Play/pause/scrub here drive all players; parent map/charts share `progress`.
 *
 * Legacy `refSide`/`otherSide` still work; prefer `sides` for 3–4 laps.
 */
export function DualSessionVideos({
  sides,
  refSide,
  otherSide,
  progress,
  onProgress,
}: {
  sides?: MultiVideoSide[];
  /** @deprecated Prefer `sides`. */
  refSide?: DualVideoSide;
  /** @deprecated Prefer `sides`. */
  otherSide?: DualVideoSide;
  progress: number | null;
  onProgress: (next: number | null) => void;
}) {
  const resolved: MultiVideoSide[] = sides?.length
    ? sides.slice(0, 4)
    : refSide && otherSide
      ? [
          { ...refSide, color: "#f97316" },
          { ...otherSide, color: "#38bdf8" },
        ]
      : [];

  const playersRef = useRef<(VideoPlayerHandle | null)[]>([]);
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(progress ?? 0);
  progressRef.current = progress ?? 0;
  const lapMs = resolved.map((side) => side.lap.lapTimeMs);

  const seekAll = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      resolved.forEach((side, index) => {
        const t = dualVideoTimeAtProgress(side, clamped);
        if (t != null) playersRef.current[index]?.seek(t);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seek by current sides snapshot
    [resolved.map((s) => `${s.lap.id}:${s.video?.id ?? ""}:${s.video?.offsetSec ?? 0}`).join("|")],
  );

  useEffect(() => {
    if (progress == null) return;
    seekAll(progress);
  }, [progress, seekAll]);

  useEffect(() => {
    if (!playing) {
      playersRef.current.forEach((p) => p?.pause());
      return;
    }
    playersRef.current.forEach((p) => p?.pause());
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      const next = advanceSharedProgress(progressRef.current, dt, ...lapMs);
      progressRef.current = next;
      onProgress(next);
      seekAll(next);
      if (next >= 1) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onProgress, seekAll, lapMs.join(",")]);

  const positiveMs = lapMs.filter((ms) => ms > 0);
  const sharedMs = Math.max(1, positiveMs.length ? Math.min(...positiveMs) : 1);
  const lapTimeSec = ((progress ?? 0) * sharedMs) / 1000;
  const canPlay = resolved.some(sideHasPlayableVideo);
  const hasMeta = resolved.some(sideHasVideoMeta);

  if (!resolved.length || (!canPlay && !hasMeta)) return null;

  const count = resolved.length;

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {count > 2 ? `${count}-way` : "Dual"} onboard · lap-relative sync
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Shared cursor from lap start — play/pause/scrub all sessions
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
            {playing ? "Pause" : count > 2 ? "Play all" : "Play both"}
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

      <div
        className={`${gridClass(count)} max-h-[70vh] overflow-y-auto sm:max-h-none`}
      >
        {resolved.map((side, index) => (
          <SidePlayer
            key={`${side.lap.id}-${index}`}
            side={side}
            color={side.color}
            onBind={(h) => {
              playersRef.current[index] = h;
            }}
          />
        ))}
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
            seekAll(next);
          }}
          className="w-full accent-orange-500"
        />
      </label>
    </div>
  );
}
