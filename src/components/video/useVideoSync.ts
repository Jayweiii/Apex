"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerSyncEvent } from "@/lib/playback-sync";

export type VideoPlayerHandle = {
  getTime: () => number;
  /** Seconds, or 0 until the player knows (metadata loaded). */
  getDuration?: () => number;
  seek: (seconds: number) => void;
  isPaused: () => boolean;
  play: () => void;
  pause: () => void;
  /** Playback rate when the underlying player supports it (YouTube / HTML5). */
  getRate?: () => number;
  setRate?: (rate: number) => void;
};

export type VideoPlayerEventHandler = (event: PlayerSyncEvent) => void;

/**
 * Polls a player handle while playing and reports video time (~15 Hz).
 * Chart/map scrubbing should call seek() on the same handle.
 */
export function useVideoSync(options: {
  player: VideoPlayerHandle | null;
  onTime: (videoTime: number) => void;
  enabled?: boolean;
}) {
  const { player, onTime, enabled = true } = options;
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!player || !enabled) return;
    let raf = 0;
    let last = 0;
    let lastPaused: boolean | null = null;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const paused = player.isPaused();
      if (lastPaused !== paused) {
        lastPaused = paused;
        setPlaying(!paused);
      }
      if (paused) return;
      if (now - last < 66) return; // ~15 Hz
      last = now;
      onTimeRef.current(player.getTime());
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [player, enabled]);

  const seek = useCallback(
    (seconds: number) => {
      player?.seek(seconds);
      onTimeRef.current(seconds);
    },
    [player],
  );

  return { playing, seek };
}
