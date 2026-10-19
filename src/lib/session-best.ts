import type { SupabaseClient } from "@supabase/supabase-js";

type BestLapRow = {
  session_id: string;
  lap_time_ms: number;
  excluded?: boolean | null;
};

/**
 * Session best lap times, ignoring excluded laps when the column exists.
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
    .select("session_id, lap_time_ms, excluded")
    .in("session_id", sessionIds);

  if (withExcluded.error && /excluded/i.test(withExcluded.error.message)) {
    const fallback = await client
      .from("laps")
      .select("session_id, lap_time_ms")
      .in("session_id", sessionIds);
    laps = (fallback.data ?? []) as BestLapRow[];
  } else if (!withExcluded.error) {
    laps = (withExcluded.data ?? []) as BestLapRow[];
  }

  for (const lap of laps) {
    if (lap.excluded) continue;
    const current = best.get(lap.session_id);
    if (current == null || lap.lap_time_ms < current) {
      best.set(lap.session_id, lap.lap_time_ms);
    }
  }
  return best;
}
