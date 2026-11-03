/**
 * Monotonic lap-time guard for the HUD. The displayed time within a lap may
 * never decrease (e.g. across a respawn or a tick rewind); it resets only when
 * the lap counter changes.
 */
export interface LapClock {
  lap: number;
  shownMs: number;
}

export function createLapClock(): LapClock {
  return { lap: 0, shownMs: 0 };
}

/** Call whenever a new race/world starts (the lap number alone can't tell). */
export function resetLapClock(clock: LapClock): void {
  clock.lap = 0;
  clock.shownMs = 0;
}

export function guardLapTime(clock: LapClock, lap: number, rawMs: number): number {
  if (lap !== clock.lap) {
    clock.lap = lap;
    clock.shownMs = Math.max(0, rawMs);
  } else if (rawMs > clock.shownMs) {
    clock.shownMs = rawMs;
  }
  return clock.shownMs;
}
