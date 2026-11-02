"use client";

import { useEffect, useState } from "react";

export type ProgressSubscribe = (
  listener: (progress: number) => void,
) => () => void;

/**
 * While `playing`, follow the playback clock through `subscribe` and
 * re-render only the calling component (throttled to `intervalMs`).
 * Otherwise return the parent's committed `progress`.
 *
 * Playback clocks deliberately do not push React state every frame — that
 * re-rendered whole session/compare views and starved taps on phones — so
 * small live readouts (scrubber, clock, gap) use this hook instead.
 */
export function useLiveProgress(
  progress: number,
  playing: boolean,
  subscribe?: ProgressSubscribe | null,
  intervalMs = 66,
): number {
  const [live, setLive] = useState<number | null>(null);
  useEffect(() => {
    if (!playing || !subscribe) return;
    let last = 0;
    const unsubscribe = subscribe((next) => {
      const now = performance.now();
      if (now - last < intervalMs && next < 1) return;
      last = now;
      setLive(next);
    });
    return () => {
      unsubscribe();
      setLive(null);
    };
  }, [playing, subscribe, intervalMs]);
  return playing && live != null ? live : progress;
}
