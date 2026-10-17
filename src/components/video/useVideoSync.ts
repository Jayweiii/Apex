"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VideoPlayerHandle = {
  getTime: () => number;
  seek: (seconds: number) => void;
  isPaused: () => boolean;
  play: () => void;
  pause: () => void;
};

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
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const paused = player.isPaused();
      setPlaying(!paused);
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
