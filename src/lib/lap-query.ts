/**
 * Shared PostgREST column lists so list/compare views avoid pulling
 * full telemetry / source_gps until a lap is actually shown.
 */

/** Picker + stats — no telemetry blob. */
export const LAP_META_COLUMNS =
  "id, session_id, user_id, lap_number, lap_time_ms, start_offset_sec, started_at_ms, excluded, exclude_reason, start_offset_override, end_offset_override";

/** Meta + telemetry for charts / map / video sync. */
export const LAP_TELEMETRY_COLUMNS = `${LAP_META_COLUMNS}, telemetry`;

/** Session fields for compare / account lists (never source_gps). */
export const SESSION_LIST_COLUMNS =
  "id, name, track_id, car, driver_name, user_id, visibility, created_at, source_kind, gps_quality";

/** Session detail without the large source_gps blob (hydrate on demand). */
export const SESSION_DETAIL_COLUMNS =
  "id, name, user_id, car, driver_name, track_id, visibility, source_kind, gps_quality, notes, weather, tires, started_at, session_date, created_at, filename";

/** Session detail including source_gps (needed when lap stubs need hydrate). */
export const SESSION_DETAIL_WITH_SOURCE_GPS = `${SESSION_DETAIL_COLUMNS}, source_gps`;

export function mergeLapTelemetry<T extends { id: string; telemetry?: unknown }>(
  existing: T[],
  withTelemetry: T[],
): T[] {
  if (!withTelemetry.length) return existing;
  const byId = new Map(withTelemetry.map((lap) => [lap.id, lap]));
  return existing.map((lap) => {
    const next = byId.get(lap.id);
    return next ? { ...lap, ...next } : lap;
  });
}

export function lapsMissingTelemetry(
  laps: { id: string; telemetry?: unknown[] | null }[],
  lapIds: string[],
): string[] {
  const byId = new Map(laps.map((lap) => [lap.id, lap]));
  const missing: string[] = [];
  for (const id of lapIds) {
    const lap = byId.get(id);
    if (!lap) continue;
    const tel = lap.telemetry;
    if (!Array.isArray(tel) || tel.length === 0) missing.push(id);
  }
  return missing;
}
