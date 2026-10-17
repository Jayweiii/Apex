import type { LapRow } from "@/lib/types";
import { getTrack } from "@/lib/tracks";

export type CompareSessionOption = {
  id: string;
  name: string;
  car?: string;
  kind?: string;
  trackId?: string;
  laps: LapRow[];
};

export type AccessibleSessionMeta = {
  id: string;
  name: string;
  track_id?: string | null;
  car?: string | null;
  driver_name?: string | null;
  user_id?: string | null;
  visibility?: string | null;
};

export function labelForAccessibleSession(
  session: AccessibleSessionMeta,
  currentUserId: string | null,
): { name: string; kind: string } {
  const mine = Boolean(currentUserId && session.user_id === currentUserId);
  const visibility = session.visibility ?? "friends";
  let kind = "friends";
  if (mine) kind = "upload";
  else if (visibility === "public") kind = "public";
  const track = session.track_id ? getTrack(session.track_id) : null;
  const trackLabel = track?.name ?? session.track_id ?? null;
  const parts = [session.name];
  if (session.car) parts.push(session.car);
  if (session.driver_name && !mine) parts.push(session.driver_name);
  if (trackLabel) parts.push(trackLabel);
  return { name: parts.join(" · "), kind };
}

export function groupLapsBySession(
  metas: AccessibleSessionMeta[],
  laps: LapRow[],
  currentUserId: string | null,
): CompareSessionOption[] {
  const bySession = new Map<string, LapRow[]>();
  for (const lap of laps) {
    const list = bySession.get(lap.session_id) ?? [];
    list.push(lap);
    bySession.set(lap.session_id, list);
  }
  const options: CompareSessionOption[] = [];
  for (const meta of metas) {
    const sessionLaps = (bySession.get(meta.id) ?? []).sort(
      (a, b) => a.lap_number - b.lap_number,
    );
    if (!sessionLaps.length) continue;
    const labeled = labelForAccessibleSession(meta, currentUserId);
    options.push({
      id: meta.id,
      name: labeled.name,
      car: meta.car ?? undefined,
      kind: labeled.kind,
      trackId: meta.track_id ?? undefined,
      laps: sessionLaps,
    });
  }
  return options;
}

/** Unique track ids present in a session meta list (stable order). */
export function trackIdsFromSessions(
  sessions: Array<{ track_id?: string | null; trackId?: string | null }>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of sessions) {
    const id = session.track_id ?? session.trackId ?? null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
