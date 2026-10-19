"use client";

import { PlaybackControls } from "@/components/PlaybackControls";
import { Mp4Player } from "@/components/video/Mp4Player";
import { YouTubePlayer } from "@/components/video/YouTubePlayer";
import type { VideoPlayerHandle } from "@/components/video/useVideoSync";
import {
  dualVideoTimeAtProgress,
  sideHasPlayableVideo,
  sideHasVideoMeta,
  type DualVideoSide,
} from "@/lib/dual-video-sync";
import { formatLapTime } from "@/lib/format";
import {
  advancePlaybackProgress,
  isPlaybackSpeed,
  PLAYBACK_SPEEDS,
  scrubPlaybackProgress,
  type PlaybackSpeed,
} from "@/lib/playback";
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
  return "grid gap-3 sm:grid-cols-2";
}

/**
 * Up to 4 onboard videos lockstepped by shared lap-relative progress (0..1).
 * Our RAF clock (speed-aware) drives players; parent map/charts share `progress`.
 * Respects each video's saved offset. Play only on explicit click (no hover).
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const progressRef = useRef(progress ?? 0);
  progressRef.current = progress ?? 0;
  const lapMs = resolved.map((side) => side.lap.lapTimeMs);
  const positiveMs = lapMs.filter((ms) => ms > 0);
  const sharedMs = Math.max(1, positiveMs.length ? Math.min(...positiveMs) : 1);

  const seekAll = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(1, next));
      resolved.forEach((side, index) => {
        const t = dualVideoTimeAtProgress(side, clamped);
        if (t != null) playersRef.current[index]?.seek(t);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seek by current sides snapshot
    [
      resolved
        .map((s) => `${s.lap.id}:${s.video?.id ?? ""}:${s.video?.offsetSec ?? 0}`)
        .join("|"),
    ],
  );

  useEffect(() => {
    if (progress == null) return;
    seekAll(progress);
  }, [progress, seekAll]);

  useEffect(() => {
    playersRef.current.forEach((p) => p?.pause());
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      const next = advancePlaybackProgress(
        progressRef.current,
        dt,
        sharedMs,
        speed,
      );
      progressRef.current = next;
      onProgress(next);
      seekAll(next);
      if (next >= 1) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onProgress, seekAll, sharedMs, speed]);

  useEffect(() => {
    if (!resolved.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const root = rootRef.current;
      if (root && document.activeElement && !root.contains(document.activeElement)) {
        // Still allow when the event originates inside our region.
        if (!root.contains(target)) return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        setPlaying((was) => {
          if (was) return false;
          if ((progressRef.current ?? 0) >= 1) onProgress(0);
          return true;
        });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        const next = scrubPlaybackProgress(progressRef.current, -1);
        onProgress(next);
        seekAll(next);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        const next = scrubPlaybackProgress(progressRef.current, 1);
        onProgress(next);
        seekAll(next);
        return;
      }
      if (event.key >= "1" && event.key <= "4") {
        const next = PLAYBACK_SPEEDS[Number(event.key) - 1];
        if (next != null && isPlaybackSpeed(next)) setSpeed(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolved.length, onProgress, seekAll]);

  const canPlay = resolved.some(sideHasPlayableVideo);
  const hasMeta = resolved.some(sideHasVideoMeta);

  if (!resolved.length || (!canPlay && !hasMeta)) return null;

  const count = resolved.length;
  const at = progress ?? 0;

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="w-full space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 outline-none focus-visible:ring-1 focus-visible:ring-orange-500/40 sm:p-4"
    >
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          {count > 2 ? `${count}-way` : "Dual"} onboard · lap-relative sync
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Shared cursor from lap start — driven by our clock (not hover). Each
          side keeps its saved YouTube offset.
        </p>
      </div>

      <div className={`${gridClass(count)} w-full`}>
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

      <PlaybackControls
        progress={at}
        onProgress={(next) => {
          setPlaying(false);
          onProgress(next);
          seekAll(next);
        }}
        playing={playing}
        onTogglePlay={() => {
          if (at >= 1) onProgress(0);
          setPlaying((p) => !p);
        }}
        speed={speed}
        onSpeed={setSpeed}
        durationMs={sharedMs}
        disabled={!canPlay && !hasMeta}
        label={count > 2 ? "Play all" : "Play both"}
      />
    </div>
  );
}
