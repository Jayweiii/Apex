import { preferGpsSession, type GpsQuality } from "@/lib/gps-quality";
import type { LapRow, SessionVideo } from "@/lib/types";
import { getTrack } from "@/lib/tracks";

export type CompareSessionOption = {
  id: string;
  name: string;
  /** Raw session title (without track/driver mashup). */
  title?: string;
  car?: string;
  driverName?: string;
  createdAt?: string;
  kind?: string;
  trackId?: string;
  sourceKind?: "csv" | "gopro" | "logger" | null;
  gpsQuality?: GpsQuality | null;
  /** Onboard clips for dual-session video compare. */
  videos?: SessionVideo[];
  /** Resolved MP4 download/object URLs keyed by video id. */
  videoSrcById?: Record<string, string>;
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
  source_kind?: string | null;
  gps_quality?: GpsQuality | null;
  created_at?: string | null;
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

/** Compact picker label: track · date · driver/name. */
export function formatSessionPickerLabel(
  session: Pick<
    CompareSessionOption,
    "name" | "title" | "trackId" | "driverName" | "createdAt" | "car" | "kind"
  >,
): string {
  const track = session.trackId
    ? (getTrack(session.trackId)?.name ?? session.trackId)
    : null;
  const date = formatSessionPickerDate(session.createdAt);
  const who =
    session.driverName?.trim() ||
    session.title?.trim() ||
    session.name.split(" · ")[0]?.trim() ||
    session.name;
  const parts = [track, date, who].filter(Boolean) as string[];
  if (session.car && who && !who.includes(session.car)) {
    parts.push(session.car);
  }
  if (!parts.length) return session.name;
  return parts.join(" · ");
}

export function formatSessionPickerDate(
  createdAt: string | null | undefined,
): string | null {
  if (!createdAt) return null;
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
    const sourceKind =
      meta.source_kind === "gopro" ||
      meta.source_kind === "csv" ||
      meta.source_kind === "logger"
        ? meta.source_kind
        : null;
    options.push({
      id: meta.id,
      name: labeled.name,
      title: meta.name,
      car: meta.car ?? undefined,
      driverName: meta.driver_name ?? undefined,
      createdAt: meta.created_at ?? undefined,
      kind: labeled.kind,
      trackId: meta.track_id ?? undefined,
      sourceKind,
      gpsQuality: meta.gps_quality ?? null,
      laps: sessionLaps,
    });
  }
  // Prefer GoPro GPS sessions over phone CSV when listing compare peers.
  return options.sort((a, b) => preferGpsSession(a, b));
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
