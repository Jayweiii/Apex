/**
 * Tap-based lap-sequence matching for full-session (or multi-crossing) videos.
 * User taps S/F crossings at video times v_i; intervals are slid over logged
 * lap times to find alignment, then least-squares solves offsetSec + rate.
 */

export type LapSequenceSolve = {
  offsetSec: number;
  rate: number;
  alignmentIndex: number;
  rmsErrorSec: number;
  predictedNextSec?: number;
};

export type LoggedLapStart = {
  /** Session-time of lap start (seconds). */
  startOffsetSec: number;
  lapTimeMs: number;
};

const MAX_RMS_SEC = 0.25;

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Least-squares: v_i ≈ offset + rate * s_i
 * where s_i are logged lap start offsets and v_i are video crossing times.
 */
export function fitOffsetRate(
  videoTimes: number[],
  sessionStarts: number[],
): { offsetSec: number; rate: number; rmsErrorSec: number } | null {
  if (videoTimes.length < 2 || videoTimes.length !== sessionStarts.length) {
    return null;
  }
  const n = videoTimes.length;
  const meanS = mean(sessionStarts);
  const meanV = mean(videoTimes);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (sessionStarts[i] - meanS) * (videoTimes[i] - meanV);
    den += (sessionStarts[i] - meanS) ** 2;
  }
  const rate = den === 0 ? 1 : num / den;
  const offsetSec = meanV - rate * meanS;
  let sq = 0;
  for (let i = 0; i < n; i += 1) {
    const pred = offsetSec + rate * sessionStarts[i];
    sq += (videoTimes[i] - pred) ** 2;
  }
  return {
    offsetSec,
    rate,
    rmsErrorSec: Math.sqrt(sq / n),
  };
}

/**
 * Slide video intervals over the logged lap-time sequence and pick best k.
 */
export function solveLapSequence(
  videoCrossingsSec: number[],
  laps: LoggedLapStart[],
  options?: { maxRmsSec?: number },
): LapSequenceSolve | null {
  const maxRms = options?.maxRmsSec ?? MAX_RMS_SEC;
  if (videoCrossingsSec.length < 2 || laps.length < 1) return null;

  const sortedV = [...videoCrossingsSec].sort((a, b) => a - b);
  const intervals = [];
  for (let i = 1; i < sortedV.length; i += 1) {
    intervals.push(sortedV[i] - sortedV[i - 1]);
  }
  if (!intervals.length) return null;

  const lapDurations = laps.map((lap) => lap.lapTimeMs / 1000);
  let best: LapSequenceSolve | null = null;

  const maxK = lapDurations.length - intervals.length;
  for (let k = 0; k <= Math.max(0, maxK); k += 1) {
    // Crossing i maps to start of lap (k+i); last crossing can be finish of last matched lap
    // = start of lap (k+intervals.length) if present, else start + duration of last.
    const sessionStarts: number[] = [];
    for (let i = 0; i < sortedV.length; i += 1) {
      const lapIndex = k + i;
      if (lapIndex < laps.length) {
        sessionStarts.push(laps[lapIndex].startOffsetSec);
      } else if (lapIndex === laps.length) {
        const last = laps[laps.length - 1];
        sessionStarts.push(last.startOffsetSec + last.lapTimeMs / 1000);
      } else {
        break;
      }
    }
    if (sessionStarts.length !== sortedV.length) continue;

    // Interval residual score for ranking alignments
    let intervalSq = 0;
    for (let i = 0; i < intervals.length; i += 1) {
      const expected = lapDurations[k + i];
      if (expected == null) {
        intervalSq = Number.POSITIVE_INFINITY;
        break;
      }
      intervalSq += (intervals[i] - expected) ** 2;
    }
    if (!Number.isFinite(intervalSq)) continue;

    const fit = fitOffsetRate(sortedV, sessionStarts);
    if (!fit) continue;
    if (fit.rmsErrorSec > maxRms) continue;

    const nextLap = laps[k + sortedV.length];
    const predictedNextSec = nextLap
      ? fit.offsetSec + fit.rate * nextLap.startOffsetSec
      : (() => {
          const last = laps[Math.min(k + sortedV.length - 1, laps.length - 1)];
          if (!last) return undefined;
          return (
            fit.offsetSec +
            fit.rate * (last.startOffsetSec + last.lapTimeMs / 1000)
          );
        })();

    const candidate: LapSequenceSolve = {
      offsetSec: fit.offsetSec,
      rate: fit.rate,
      alignmentIndex: k,
      rmsErrorSec: fit.rmsErrorSec,
      predictedNextSec,
    };
    if (
      !best ||
      intervalSq <
        (best.rmsErrorSec ** 2) * intervals.length + 1e-9 ||
      candidate.rmsErrorSec < best.rmsErrorSec
    ) {
      // Prefer lower interval mismatch, then lower fit RMS.
      const bestInterval =
        best == null
          ? Number.POSITIVE_INFINITY
          : (() => {
              let sq = 0;
              for (let i = 0; i < intervals.length; i += 1) {
                sq += (intervals[i] - lapDurations[best.alignmentIndex + i]) ** 2;
              }
              return sq;
            })();
      if (!best || intervalSq < bestInterval - 1e-9 || (Math.abs(intervalSq - bestInterval) < 1e-9 && candidate.rmsErrorSec < best.rmsErrorSec)) {
        best = candidate;
      }
    }
  }

  return best;
}

/** After two taps, predict the next crossing from logged lap times. */
export function predictNextCrossing(
  videoCrossingsSec: number[],
  laps: LoggedLapStart[],
): number | null {
  if (videoCrossingsSec.length < 2) return null;
  const solved = solveLapSequence(videoCrossingsSec, laps, {
    maxRmsSec: 1.0,
  });
  return solved?.predictedNextSec ?? null;
}
