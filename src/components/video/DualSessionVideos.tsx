"use client";

import { useStableCallback } from "@/lib/use-stable-callback";
import { PlaybackControls } from "@/components/PlaybackControls";
import { Mp4Player } from "@/components/video/Mp4Player";
import { YouTubePlayer } from "@/components/video/YouTubePlayer";
import type { VideoPlayerHandle } from "@/components/video/useVideoSync";
import {
  dualProgressFromVideoTime,
  dualVideoTimeAtProgress,
  sharedCompareDurationMs,
  sideHasPlayableVideo,
  sideHasVideoMeta,
  type DualVideoSide,
} from "@/lib/dual-video-sync";
import { formatLapTime } from "@/lib/format";
import {
  isPlaybackSpeed,
  PLAYBACK_SPEEDS,
  playbackProgressAtWallClock,
  scrubPlaybackProgress,
  type PlaybackSpeed,
} from "@/lib/playback";
import {
  createSyncSuppress,
  DRIFT_CHECK_INTERVAL_MS,
  nearestPlaybackSpeed,
  needsDriftCorrection,
  type PlayerSyncEvent,
  type SyncAuthority,
} from "@/lib/playback-sync";
import { useCallback, useEffect, useRef, useState } from "react";

/** Throttle React progress while playing — map/cursors use subscribe. */
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

function gridClass(count: number, compact: boolean) {
  const gap = compact ? "gap-1.5" : "gap-3";
  if (count <= 1) return `grid ${gap}`;
  if (count === 2) return `grid ${gap} lg:grid-cols-2`;
  return `grid ${gap} sm:grid-cols-2`;
}

/**
 * Up to 4 onboard videos lockstepped by shared elapsed-ms progress (0..1).
 * Clock = max lap_time_ms; same t for every side (spatial gap on map).
 * Two-way: track controls drive all players; any YouTube play/pause/seek/rate
 * drives the shared track cursor (and the other players).
 */
export function DualSessionVideos({
  sides,
  refSide,
  otherSide,
  progress,
  onProgress,
  onPlayingChange,
  onProgressSubscribe,
  onControls,
  compact = false,
}: {
  sides?: MultiVideoSide[];
  /** @deprecated Prefer `sides`. */
  refSide?: DualVideoSide;
  /** @deprecated Prefer `sides`. */
  otherSide?: DualVideoSide;
  progress: number | null;
  onProgress: (next: number | null) => void;
  /** Lets parent gate hover preview while videos are playing. */
  onPlayingChange?: (playing: boolean) => void;
  /** Full-rate progress while playing (map / DOM cursors). */
  onProgressSubscribe?: (
    subscribe: (listener: (progress: number) => void) => () => void,
  ) => void;
  /**
   * Hands the parent this clock's play toggle, so other Play buttons (the
   * map overlay on phones) drive the same clock instead of a second,
   * disconnected `playing` flag (that Play showed "Pause" but never moved).
   */
  onControls?: (controls: { togglePlay: () => void }) => void;
  /** Dense chrome for one-screen compare dashboard. */
  compact?: boolean;
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
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const listenersRef = useRef(new Set<(progress: number) => void>());
  /** Absolute clock: progress = origin + (now − start) × speed / duration. */
  const clockOriginRef = useRef<{ progress: number; ms: number } | null>(null);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);
  const progressRef = useRef(progress ?? 0);
  const authorityRef = useRef<SyncAuthority>("clock");
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // While playing, RAF owns progressRef and the parent's `progress` is not
  // updated (see below). Adopt the prop only when it actually changes while
  // paused (scrub / seek), so pausing never rewinds to a stale value.
  const lastProgressPropRef = useRef(progress);
  if (!playing) {
    if (progress !== lastProgressPropRef.current) {
      progressRef.current = progress ?? 0;
    }
    clockOriginRef.current = null;
  }
  lastProgressPropRef.current = progress;
  const suppress = useRef(createSyncSuppress());
  const lapMs = resolved.map((side) => side.lap.lapTimeMs);
  const sharedMs = sharedCompareDurationMs(...lapMs);
  const sharedMsRef = useRef(sharedMs);
  sharedMsRef.current = sharedMs;

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    clockOriginRef.current = {
      progress: progressRef.current,
      ms: performance.now(),
    };
    setSpeedState(next);
  }, []);

  const notify = useCallback((next: number) => {
    progressRef.current = next;
    for (const listener of listenersRef.current) listener(next);
  }, []);

  const subscribe = useCallback((listener: (progress: number) => void) => {
    listenersRef.current.add(listener);
    listener(progressRef.current);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    onProgressSubscribe?.(subscribe);
  }, [onProgressSubscribe, subscribe]);

  const onProgressStable = useStableCallback(onProgress);
  const togglePlay = useCallback(() => {
    authorityRef.current = "clock";
    if (progressRef.current >= 1) {
      progressRef.current = 0;
      onProgressStable(0);
    }
    setPlaying((p) => !p);
  }, [onProgressStable, setPlaying]);
  useEffect(() => {
    onControls?.({ togglePlay });
  }, [onControls, togglePlay]);

  const sideKey = resolved
    .map((s) => `${s.lap.id}:${s.video?.id ?? ""}:${s.video?.offsetSec ?? 0}`)
    .join("|");

  const driveAll = useCallback(
    (action: "play" | "pause" | "rate", value?: number) => {
      suppress.current.arm();
      playersRef.current.forEach((player, index) => {
        if (!player) return;
        // Don't restart a finished shorter lap while the shared clock continues.
        if (action === "play") {
          const side = resolved[index];
          if (side) {
            const elapsed =
              progressRef.current * (Math.max(1, sharedMs) / 1000);
            if (elapsed >= side.lap.lapTimeMs / 1000) {
              player.pause();
              return;
            }
          }
          player.play();
        } else if (action === "pause") player.pause();
        else if (action === "rate" && value != null) player.setRate?.(value);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sides via sideKey/sharedMs
    [sideKey, sharedMs],
  );

  const seekAll = useCallback(
    (next: number, force = false) => {
      const clamped = Math.max(0, Math.min(1, next));
      suppress.current.arm();
      resolved.forEach((side, index) => {
        const t = dualVideoTimeAtProgress(side, clamped, sharedMs);
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
    [sideKey, sharedMs],
  );

  useEffect(() => {
    if (progress == null) return;
    if (authorityRef.current !== "clock") return;
    if (playing) return;
    seekAll(progress, true);
  }, [progress, playing, seekAll]);

  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (!playing) {
      if (authorityRef.current === "clock") driveAll("pause");
      clockOriginRef.current = null;
      // Commit the final clock position once on pause (none during play).
      if (wasPlayingRef.current) onProgressRef.current(progressRef.current);
      wasPlayingRef.current = false;
      return;
    }
    wasPlayingRef.current = true;
    if (authorityRef.current !== "clock") return;
    driveAll("play");
    driveAll("rate", speedRef.current);
    clockOriginRef.current = {
      progress: progressRef.current,
      ms: performance.now(),
    };
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (authorityRef.current !== "clock") return;
      const origin = clockOriginRef.current;
      if (!origin) return;
      const next = playbackProgressAtWallClock({
        originProgress: origin.progress,
        originMs: origin.ms,
        nowMs: now,
        durationMs: sharedMsRef.current,
        speed: speedRef.current,
      });
      // No parent setState per frame: subscribers (map, chart cursor,
      // scrubber, gap readout) follow `notify`. Re-rendering the compare
      // page at 20 Hz starved taps on phones.
      notify(next);
      if (next >= 1) {
        onProgressRef.current(next);
        clockOriginRef.current = null;
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    // Do not depend on onProgress / speed — absolute clock + refs avoid
    // React setState restarting RAF and throttling play rate.
    return () => cancelAnimationFrame(raf);
  }, [playing, driveAll, notify]);

  // Apply rate changes without restarting the absolute clock effect.
  useEffect(() => {
    if (!playing || authorityRef.current !== "clock") return;
    driveAll("rate", speed);
  }, [playing, speed, driveAll]);

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
        // Clock owns play/pause from PlaybackControls — ignore player play
        // echoes (buffering resume) so wall-clock RAF keeps driving 1x.
        if (authorityRef.current === "clock" && playingRef.current) return;
        authorityRef.current = "video";
        setPlaying(true);
        const next = dualProgressFromVideoTime(
          side,
          playersRef.current[sideIndex]?.getTime() ?? 0,
          sharedMs,
        );
        notify(next);
        onProgress(next);
        suppress.current.arm();
        resolved.forEach((other, index) => {
          if (index === sideIndex) return;
          const t = dualVideoTimeAtProgress(other, next, sharedMs);
          const player = playersRef.current[index];
          if (!player) return;
          if (t != null) player.seek(t);
          player.setRate?.(speed);
          const elapsed = next * (sharedMs / 1000);
          if (elapsed < other.lap.lapTimeMs / 1000) player.play();
        });
        return;
      }
      if (event.type === "pause" || event.type === "ended") {
        // A shorter lap hitting ended must not stop the shared max clock.
        if (event.type === "ended") {
          const next = dualProgressFromVideoTime(
            side,
            playersRef.current[sideIndex]?.getTime() ??
              side.lap.lapTimeMs / 1000,
            sharedMs,
          );
          notify(next);
          onProgress(next);
          if (next < 1 && authorityRef.current === "clock") return;
          if (next < 1) {
            authorityRef.current = "clock";
            setPlaying(true);
            return;
          }
        }
        // Ignore pause echoes while the shared clock is driving playback.
        if (
          event.type === "pause" &&
          authorityRef.current === "clock" &&
          playingRef.current
        ) {
          return;
        }
        authorityRef.current = "video";
        setPlaying(false);
        suppress.current.arm();
        playersRef.current.forEach((p, index) => {
          if (index !== sideIndex) p?.pause();
        });
        if (event.type === "ended") {
          notify(1);
          onProgress(1);
        } else {
          const time = playersRef.current[sideIndex]?.getTime() ?? 0;
          const next = dualProgressFromVideoTime(side, time, sharedMs);
          notify(next);
          onProgress(next);
          seekAll(next, true);
        }
        return;
      }
      if (event.type === "seek") {
        authorityRef.current = "video";
        setPlaying(false);
        const next = dualProgressFromVideoTime(side, event.time, sharedMs);
        notify(next);
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
        const next = dualProgressFromVideoTime(side, event.time, sharedMs);
        notify(next);
        onProgress(next);
        resolved.forEach((other, index) => {
          if (index === sideIndex) return;
          const t = dualVideoTimeAtProgress(other, next, sharedMs);
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
    [sideKey, onProgress, seekAll, speed, sharedMs, notify],
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
          progressSubscribe={subscribe}
          onProgress={(next) => {
            authorityRef.current = "clock";
            setPlaying(false);
            onProgress(next);
          }}
          playing={playing}
          onTogglePlay={togglePlay}
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
      className={`w-full outline-none focus-visible:ring-1 focus-visible:ring-orange-500/40 ${
        compact
          ? "space-y-1.5 rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
          : "space-y-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-3 sm:p-4"
      }`}
    >
      {!compact ? (
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            {count > 2 ? `${count}-way` : "Dual"} onboard · time sync
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Same elapsed ms from each lap start — map shows the gap; all players
            and the shared cursor stay locked.
          </p>
        </div>
      ) : (
        <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {count > 2 ? `${count}-way` : "Dual"} onboard · time
        </p>
      )}

      <div className={`${gridClass(count, compact)} w-full`}>
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
        progressSubscribe={subscribe}
        onProgress={(next) => {
          authorityRef.current = "clock";
          setPlaying(false);
          onProgress(next);
          seekAll(next, true);
        }}
        playing={playing}
        onTogglePlay={togglePlay}
        speed={speed}
        onSpeed={(next) => {
          authorityRef.current = "clock";
          setSpeed(next);
          driveAll("rate", next);
        }}
        durationMs={sharedMs}
        disabled={!canPlay && !hasMeta}
        label={count > 2 ? "Play all" : "Play both"}
        compact={compact}
        sticky={compact}
      />
    </div>
  );
}
