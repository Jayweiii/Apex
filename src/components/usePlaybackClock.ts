"use client";

import {
  clampPlaybackProgress,
  isPlaybackSpeed,
  PLAYBACK_SPEEDS,
  playbackProgressAtWallClock,
  scrubPlaybackProgress,
  type PlaybackSpeed,
} from "@/lib/playback";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** How often to push progress into React state while playing (scrubber UI).
 * Map markers also follow this unless they subscribe to `subscribe`. */
const UI_PROGRESS_INTERVAL_MS = 50;

/**
 * Own-clock playback: absolute wall clock
 * `progress = origin + (now - start) * speed / duration`
 * so React setState / effect churn cannot throttle the rate.
 *
 * While playing, `progressRef` + `subscribe` update every frame (map/cursor
 * overlays). React `progress` state is throttled so charts are not
 * re-rendered / remounted each frame.
 */
export function usePlaybackClock({
  durationMs,
  enabled = true,
  rootRef,
}: {
  durationMs: number;
  enabled?: boolean;
  /** When set, shortcuts apply when focus / event target is inside this node. */
  rootRef?: RefObject<HTMLElement | null>;
}) {
  const [progress, setProgressState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const progressRef = useRef(0);
  const durationRef = useRef(durationMs);
  durationRef.current = durationMs;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const listenersRef = useRef(new Set<(progress: number) => void>());
  /** Absolute clock origin — rebased on play / scrub / speed change. */
  const originRef = useRef<{ progress: number; ms: number } | null>(null);

  const notify = useCallback((next: number) => {
    progressRef.current = next;
    for (const listener of listenersRef.current) listener(next);
  }, []);

  const setProgress = useCallback(
    (next: number | null) => {
      if (next == null) return;
      const clamped = clampPlaybackProgress(next);
      notify(clamped);
      setProgressState(clamped);
      if (originRef.current) {
        originRef.current = { progress: clamped, ms: performance.now() };
      }
    },
    [notify],
  );

  const setSpeed = useCallback((next: number) => {
    if (!isPlaybackSpeed(next)) return;
    // Rebase absolute clock so rate changes don't jump.
    originRef.current = {
      progress: progressRef.current,
      ms: performance.now(),
    };
    setSpeedState(next);
  }, []);

  const pause = useCallback(() => {
    originRef.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    setPlaying((was) => {
      if (!was && progressRef.current >= 1) {
        notify(0);
        setProgressState(0);
      }
      originRef.current = {
        progress: progressRef.current >= 1 ? 0 : progressRef.current,
        ms: performance.now(),
      };
      return true;
    });
  }, [notify]);

  const toggle = useCallback(() => {
    setPlaying((was) => {
      if (was) {
        originRef.current = null;
        return false;
      }
      if (progressRef.current >= 1) {
        notify(0);
        setProgressState(0);
      }
      originRef.current = {
        progress: progressRef.current >= 1 ? 0 : progressRef.current,
        ms: performance.now(),
      };
      return true;
    });
  }, [notify]);

  const subscribe = useCallback((listener: (progress: number) => void) => {
    listenersRef.current.add(listener);
    listener(progressRef.current);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!playing || !enabled) {
      originRef.current = null;
      return;
    }
    if (!originRef.current) {
      originRef.current = {
        progress: progressRef.current,
        ms: performance.now(),
      };
    }
    let raf = 0;
    let lastUi = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const origin = originRef.current;
      if (!origin) return;
      const next = playbackProgressAtWallClock({
        originProgress: origin.progress,
        originMs: origin.ms,
        nowMs: now,
        durationMs: durationRef.current,
        speed: speedRef.current,
      });
      notify(next);
      if (now - lastUi >= UI_PROGRESS_INTERVAL_MS || next >= 1) {
        lastUi = now;
        setProgressState(next);
      }
      if (next >= 1) {
        originRef.current = null;
        setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, enabled, notify]);

  useEffect(() => {
    if (!enabled) return;

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
      const root = rootRef?.current;
      if (root) {
        const active = document.activeElement;
        const inside =
          (target != null && root.contains(target)) ||
          (active != null && root.contains(active));
        if (!inside) return;
      }

      if (event.code === "Space" || event.key === " ") {
        event.preventDefault();
        toggle();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        originRef.current = null;
        setPlaying(false);
        setProgress(scrubPlaybackProgress(progressRef.current, -1));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        originRef.current = null;
        setPlaying(false);
        setProgress(scrubPlaybackProgress(progressRef.current, 1));
        return;
      }
      if (event.key >= "1" && event.key <= "4") {
        const next = PLAYBACK_SPEEDS[Number(event.key) - 1];
        if (next != null) setSpeed(next);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, rootRef, setProgress, setSpeed, toggle]);

  return {
    progress,
    progressRef,
    subscribe,
    setProgress,
    playing,
    play,
    pause,
    toggle,
    setPlaying,
    speed,
    setSpeed,
  };
}
