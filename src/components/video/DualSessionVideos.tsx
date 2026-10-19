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
import {
  createSyncSuppress,
  DRIFT_CHECK_INTERVAL_MS,
  lapProgressFromVideoTime,
  nearestPlaybackSpeed,
  needsDriftCorrection,
  type PlayerSyncEvent,
  type SyncAuthority,
} from "@/lib/playback-sync";
import { useCallback, useEffect, useRef, useState } from "react";

export type MultiVideoSide = DualVideoSide & { color: string };

function SidePlayer({
  side,
  color,
  onBind,
  onPlayerEvent,
}: {
  side: DualVideoSide;
  color: string;
  onBind: (handle: VideoPlayerHandle | null) => void;
  onPlayerEvent?: (event: PlayerSyncEvent) => void;
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
          onPlayerEvent={onPlayerEvent}
        />
      ) : side.mp4Src ? (
        <Mp4Player
          src={side.mp4Src}
          ref={(instance) => onBind(instance)}
          onPlayerEvent={onPlayerEvent}
        />
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
 * Two-way: track controls drive all players; any YouTube play/pause/seek/rate
 * drives the shared track cursor (and the other players).
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
  const authorityRef = useRef<SyncAuthority>("clock");
  const suppress = useRef(createSyncSuppress());
  const lapMs = resolved.map((side) => side.lap.lapTimeMs);
  const positiveMs = lapMs.filter((ms) => ms > 0);
  const sharedMs = Math.max(1, positiveMs.length ? Math.min(...positiveMs) : 1);

  const sideKey = resolved
    .map((s) => `${s.lap.id}:${s.video?.id ?? ""}:${s.video?.offsetSec ?? 0}`)
    .join("|");

  const driveAll = useCallback(
    (action: "play" | "pause" | "rate", value?: number) => {
      suppress.current.arm();
      playersRef.current.forEach((player) => {
        if (!player) return;
        if (action === "play") player.play();
        else if (action === "pause") player.pause();
        else if (action === "rate" && value != null) player.setRate?.(value);
      });
    },
    [],
  );

  const seekAll = useCallback(
    (next: number, force = false) => {
      const clamped = Math.max(0, Math.min(1, next));
      suppress.current.arm();
      resolved.forEach((side, index) => {
        const t = dualVideoTimeAtProgress(side, clamped);
        if (t == null) return;
        const player = playersRef.current[index];
        if (!player) return;
        const actual = player.getTime();
        if (force || needsDriftCorrection(t, actual)) {
          player.seek(t);
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seek by current sides snapshot
    [sideKey],
  );

  useEffect(() => {
    if (progress == null) return;
    if (authorityRef.current !== "clock") return;
    if (playing) return;
    seekAll(progress, true);
  }, [progress, playing, seekAll]);

  useEffect(() => {
    if (!playing) {
      if (authorityRef.current === "clock") driveAll("pause");
      return;
    }
    if (authorityRef.current !== "clock") return;
    driveAll("play");
    driveAll("rate", speed);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (authorityRef.current !== "clock") return;
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
      if (next >= 1) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onProgress, sharedMs, speed, driveAll]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (authorityRef.current !== "clock") return;
      seekAll(progressRef.current, false);
    }, DRIFT_CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, seekAll]);

  const onSidePlayerEvent = useCallback(
    (sideIndex: number, event: PlayerSyncEvent) => {
      if (suppress.current.active()) return;
      const side = resolved[sideIndex];
      if (!side?.video) return;

      if (event.type === "play") {
        authorityRef.current = "video";
        setPlaying(true);
        const next = lapProgressFromVideoTime(
          side.lap,
          playersRef.current[sideIndex]?.getTime() ?? 0,
          side.video,
        );
        progressRef.current = next;
        onProgress(next);
        suppress.current.arm();
        resolved.forEach((other, index) => {
          if (index === sideIndex) return;
          const t = dualVideoTimeAtProgress(other, next);
          const player = playersRef.current[index];
          if (!player) return;
          if (t != null) player.seek(t);
          player.setRate?.(speed);
          player.play();
        });
        return;
      }
      if (event.type === "pause" || event.type === "ended") {
        authorityRef.current = "video";
        setPlaying(false);
        suppress.current.arm();
        playersRef.current.forEach((p, index) => {
          if (index !== sideIndex) p?.pause();
        });
        if (event.type === "ended") {
          progressRef.current = 1;
          onProgress(1);
        } else {
          const time = playersRef.current[sideIndex]?.getTime() ?? 0;
          const next = lapProgressFromVideoTime(side.lap, time, side.video);
          progressRef.current = next;
          onProgress(next);
          seekAll(next, true);
        }
        return;
      }
      if (event.type === "seek") {
        authorityRef.current = "video";
        setPlaying(false);
        const next = lapProgressFromVideoTime(side.lap, event.time, side.video);
        progressRef.current = next;
        onProgress(next);
        seekAll(next, true);
        return;
      }
      if (event.type === "rate") {
        authorityRef.current = "video";
        const nextSpeed = nearestPlaybackSpeed(event.rate);
        setSpeed(nextSpeed);
        suppress.current.arm();
        playersRef.current.forEach((p, index) => {
          if (index !== sideIndex) p?.setRate?.(nextSpeed);
        });
        return;
      }
      if (event.type === "time") {
        if (authorityRef.current !== "video") return;
        const next = lapProgressFromVideoTime(side.lap, event.time, side.video);
        progressRef.current = next;
        onProgress(next);
        resolved.forEach((other, index) => {
          if (index === sideIndex) return;
          const t = dualVideoTimeAtProgress(other, next);
          const player = playersRef.current[index];
          if (t == null || !player) return;
          if (needsDriftCorrection(t, player.getTime())) {
            suppress.current.arm();
            player.seek(t);
          }
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sideKey, onProgress, seekAll, speed],
  );

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
      if (
        root &&
        document.activeElement &&
        !root.contains(document.activeElement)
      ) {
        if (!root.contains(target)) return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        authorityRef.current = "clock";
        setPlaying((was) => {
          if (was) return false;
          if ((progressRef.current ?? 0) >= 1) onProgress(0);
          return true;
        });
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        authorityRef.current = "clock";
        setPlaying(false);
        const next = scrubPlaybackProgress(progressRef.current, -1);
        onProgress(next);
        seekAll(next, true);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        authorityRef.current = "clock";
        setPlaying(false);
        const next = scrubPlaybackProgress(progressRef.current, 1);
        onProgress(next);
        seekAll(next, true);
        return;
      }
      if (event.key >= "1" && event.key <= "4") {
        const next = PLAYBACK_SPEEDS[Number(event.key) - 1];
        if (next != null && isPlaybackSpeed(next)) {
          authorityRef.current = "clock";
          setSpeed(next);
          driveAll("rate", next);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolved.length, onProgress, seekAll, driveAll]);

  const canPlay = resolved.some(sideHasPlayableVideo);
  const hasMeta = resolved.some(sideHasVideoMeta);

  if (!resolved.length) return null;
  if (!canPlay && !hasMeta) {
    return (
      <div className="w-full space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4">
        <PlaybackControls
          progress={progress ?? 0}
          onProgress={(next) => {
            authorityRef.current = "clock";
            setPlaying(false);
            onProgress(next);
          }}
          playing={playing}
          onTogglePlay={() => {
            authorityRef.current = "clock";
            if ((progress ?? 0) >= 1) onProgress(0);
            setPlaying((p) => !p);
          }}
          speed={speed}
          onSpeed={setSpeed}
          durationMs={sharedMs}
          label="Lap playback"
          hint="No onboard video — track/charts still play"
        />
      </div>
    );
  }

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
          {count > 2 ? `${count}-way` : "Dual"} onboard · two-way sync
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          Play track or any YouTube — all players and the shared cursor stay
          locked; each side keeps its saved offset.
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
            onPlayerEvent={(event) => onSidePlayerEvent(index, event)}
          />
        ))}
      </div>

      <PlaybackControls
        progress={at}
        onProgress={(next) => {
          authorityRef.current = "clock";
          setPlaying(false);
          onProgress(next);
          seekAll(next, true);
        }}
        playing={playing}
        onTogglePlay={() => {
          authorityRef.current = "clock";
          if (at >= 1) onProgress(0);
          setPlaying((p) => !p);
        }}
        speed={speed}
        onSpeed={(next) => {
          authorityRef.current = "clock";
          setSpeed(next);
          driveAll("rate", next);
        }}
        durationMs={sharedMs}
        disabled={!canPlay && !hasMeta}
        label={count > 2 ? "Play all" : "Play both"}
      />
    </div>
  );
}
