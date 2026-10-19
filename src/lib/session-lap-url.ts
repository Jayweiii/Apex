/**
 * Session-page lap selection via ?lap=N (lap number) for shareable URLs.
 * Also accepts a lap UUID for redirects from legacy /laps/[lapId] routes.
 */

export type LapPick = {
  id: string;
  lap_number: number;
  lap_time_ms: number;
  excluded?: boolean | null;
};

export function sessionLapHref(
  sessionId: string,
  lap: Pick<LapPick, "lap_number"> | number,
  options?: { videoId?: string; videoTime?: number | string | null },
): string {
  const n = typeof lap === "number" ? lap : lap.lap_number;
  const params = new URLSearchParams();
  params.set("lap", String(n));
  if (options?.videoId) params.set("v", options.videoId);
  if (options?.videoTime != null && options.videoTime !== "") {
    params.set("t", String(options.videoTime));
  }
  return `/sessions/${sessionId}?${params.toString()}`;
}

/** Legacy deep link → session page with the same lap selected. */
export function legacyLapRedirectHref(
  sessionId: string,
  lapId: string,
  query?: { v?: string; t?: string },
): string {
  const params = new URLSearchParams();
  params.set("lap", lapId);
  if (query?.v) params.set("v", query.v);
  if (query?.t) params.set("t", query.t);
  return `/sessions/${sessionId}?${params.toString()}`;
}

export function resolveSelectedLap<T extends LapPick>(
  laps: T[],
  lapParam: string | null | undefined,
): T | null {
  if (!laps.length) return null;
  if (lapParam == null || lapParam === "") {
    const eligible = laps.filter((lap) => !lap.excluded);
    const pool = eligible.length ? eligible : laps;
    return pool.reduce((best, lap) =>
      lap.lap_time_ms < best.lap_time_ms ? lap : best,
    );
  }
  const trimmed = lapParam.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && String(asNum) === trimmed) {
    const byNumber = laps.find((lap) => lap.lap_number === asNum);
    if (byNumber) return byNumber;
  }
  return laps.find((lap) => lap.id === trimmed) ?? null;
}
