"use client";

import {
  advancePlaybackProgress,
  clampPlaybackProgress,
  isPlaybackSpeed,
  PLAYBACK_SPEEDS,
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

/**
 * Own-clock playback: RAF advances progress at `speed`; seek/scrub pause
 * and set progress. Keyboard: Space play/pause, ←/→ scrub, 1–4 speeds.
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

  const setProgress = useCallback((next: number | null) => {
    if (next == null) return;
    const clamped = clampPlaybackProgress(next);
    progressRef.current = clamped;
    setProgressState(clamped);
  }, []);

  const setSpeed = useCallback((next: number) => {
    if (isPlaybackSpeed(next)) setSpeedState(next);
  }, []);

  const pause = useCallback(() => setPlaying(false), []);

  const play = useCallback(() => {
    setPlaying((was) => {
      if (!was && progressRef.current >= 1) {
        progressRef.current = 0;
        setProgressState(0);
      }
      return true;
    });
  }, []);

  const toggle = useCallback(() => {
    setPlaying((was) => {
      if (was) return false;
      if (progressRef.current >= 1) {
        progressRef.current = 0;
        setProgressState(0);
      }
      return true;
    });
  }, []);

  useEffect(() => {
    if (!playing || !enabled) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      const next = advancePlaybackProgress(
        progressRef.current,
        dt,
        durationRef.current,
        speed,
      );
      progressRef.current = next;
      setProgressState(next);
      if (next >= 1) setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, enabled, speed]);

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
        setPlaying(false);
        setProgress(scrubPlaybackProgress(progressRef.current, -1));
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setProgress(scrubPlaybackProgress(progressRef.current, 1));
        return;
      }
      if (event.key >= "1" && event.key <= "4") {
        const next = PLAYBACK_SPEEDS[Number(event.key) - 1];
        if (next != null) setSpeedState(next);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, rootRef, setProgress, toggle]);

  return {
    progress,
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
