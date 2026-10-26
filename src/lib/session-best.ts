import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isLapExcluded,
  isPlausibleFullLapMs,
  MIN_FULL_LAP_MS,
} from "@/lib/lap-quality";

type BestLapRow = {
  session_id: string;
  lap_time_ms: number;
  lap_number?: number | null;
  excluded?: boolean | null;
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Session best lap times, ignoring excluded + out/in/implausible laps.
 * Falls back to all laps if 20261019_exclude_bad_laps.sql is not applied yet.
 */
export async function bestLapMsBySession(
  client: SupabaseClient,
  sessionIds: string[],
): Promise<Map<string, number>> {
  const best = new Map<string, number>();
  if (!sessionIds.length) return best;

  let laps: BestLapRow[] = [];

  const withExcluded = await client
    .from("laps")
    .select("session_id, lap_time_ms, lap_number, excluded")
    .in("session_id", sessionIds);

  if (withExcluded.error && /excluded/i.test(withExcluded.error.message)) {
    const fallback = await client
      .from("laps")
      .select("session_id, lap_time_ms, lap_number")
      .in("session_id", sessionIds);
    laps = (fallback.data ?? []) as BestLapRow[];
  } else if (!withExcluded.error) {
    laps = (withExcluded.data ?? []) as BestLapRow[];
  }

  const bySession = new Map<string, BestLapRow[]>();
  for (const lap of laps) {
    if (isLapExcluded(lap)) continue;
    const list = bySession.get(lap.session_id) ?? [];
    list.push(lap);
    bySession.set(lap.session_id, list);
  }

  for (const [sessionId, sessionLaps] of bySession) {
    const med = median(
      sessionLaps
        .map((lap) => lap.lap_time_ms)
        .filter((ms) => ms >= MIN_FULL_LAP_MS),
    );
    let bestMs: number | null = null;
    for (const lap of sessionLaps) {
      if (!isPlausibleFullLapMs(lap.lap_time_ms, med)) continue;
      // First/last short segments without telemetry: duration gate above.
      // Also drop extreme outliers even if median missing.
      if (lap.lap_time_ms < MIN_FULL_LAP_MS) continue;
      if (bestMs == null || lap.lap_time_ms < bestMs) bestMs = lap.lap_time_ms;
    }
    if (bestMs != null) best.set(sessionId, bestMs);
  }
  return best;
}
