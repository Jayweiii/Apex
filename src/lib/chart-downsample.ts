/**
 * Cap chart series length so Recharts stays responsive on phones.
 * Keeps first/last points and evenly samples the middle.
 */
export function downsampleSeries<T>(points: T[], maxPoints: number): T[] {
  if (maxPoints < 2 || points.length <= maxPoints) return points;
  const result: T[] = [];
  const last = points.length - 1;
  const step = last / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(points[Math.round(i * step)]!);
  }
  return result;
}

/** Default chart cap — dense enough for scrub, light enough for iPhone. */
export const CHART_DISPLAY_MAX_POINTS = 320;
