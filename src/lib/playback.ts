/**
 * Shared lap playback clock: progress 0..1 driven by wall time × speed,
 * not by hover or YouTube's native clock.
 */

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export function clampPlaybackProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * Advance shared lap progress by wall-clock delta at the given speed.
 * `durationMs` is the shared timeline length (usually the lap / shortest lap).
 */
export function advancePlaybackProgress(
  progress: number,
  deltaSec: number,
  durationMs: number,
  speed: number = 1,
): number {
  const durationSec = Math.max(0.001, durationMs / 1000);
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return clampPlaybackProgress(
    progress + (deltaSec * rate) / durationSec,
  );
}

export function isPlaybackSpeed(value: number): value is PlaybackSpeed {
  return (PLAYBACK_SPEEDS as readonly number[]).includes(value);
}

export function nextPlaybackSpeed(current: number): PlaybackSpeed {
  const idx = PLAYBACK_SPEEDS.indexOf(current as PlaybackSpeed);
  if (idx < 0) return 1;
  return PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
}

/** Keyboard scrub step as a fraction of the lap (arrow keys). */
export const PLAYBACK_SCRUB_STEP = 0.02;

export function scrubPlaybackProgress(
  progress: number,
  direction: -1 | 1,
  step: number = PLAYBACK_SCRUB_STEP,
): number {
  return clampPlaybackProgress(progress + direction * step);
}
