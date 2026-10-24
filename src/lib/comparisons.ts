import {
  COMPARE_COLORS,
  MAX_COMPARE_LAPS,
  type CompareSlotParam,
} from "@/lib/compare";
import type { SessionVisibility } from "@/lib/visibility";
import type { GpsDisplayMode } from "@/lib/map-match";

export type ComparisonItem = {
  session_id: string;
  lap_id: string;
  lap_number?: number;
  color?: string;
  /** Optional per-item video offset override (seconds). */
  offset_sec?: number;
  video_id?: string;
};

export type ComparisonCursorState = {
  progress?: number | null;
  zoom?: number;
  followLapIndex?: number;
};

export type ComparisonRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  visibility: SessionVisibility;
  items: ComparisonItem[];
  reference_index: number;
  analysis_mode: GpsDisplayMode;
  cursor_state: ComparisonCursorState | null;
  forked_from: string | null;
  created_at: string;
  updated_at: string;
};

export type ComparisonDraft = {
  title?: string;
  description?: string;
  visibility?: SessionVisibility;
  items: ComparisonItem[];
  referenceIndex: number;
  analysisMode: GpsDisplayMode;
  cursorState?: ComparisonCursorState | null;
  forkedFrom?: string | null;
};

/** Live picker state emitted by LapCompare for Save comparison. */
export type ComparisonDraftSnapshot = {
  items: ComparisonItem[];
  referenceIndex: number;
  analysisMode: GpsDisplayMode;
  progress: number | null;
};

export function isComparisonItem(value: unknown): value is ComparisonItem {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.session_id === "string" &&
    row.session_id.length > 0 &&
    typeof row.lap_id === "string" &&
    row.lap_id.length > 0
  );
}

export function normalizeComparisonItems(raw: unknown): ComparisonItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ComparisonItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isComparisonItem(entry)) continue;
    const key = `${entry.session_id}:${entry.lap_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      session_id: entry.session_id,
      lap_id: entry.lap_id,
      lap_number:
        typeof entry.lap_number === "number" ? entry.lap_number : undefined,
      color:
        typeof entry.color === "string" && entry.color
          ? entry.color
          : COMPARE_COLORS[out.length % COMPARE_COLORS.length],
      offset_sec:
        typeof entry.offset_sec === "number" ? entry.offset_sec : undefined,
      video_id: typeof entry.video_id === "string" ? entry.video_id : undefined,
    });
    if (out.length >= MAX_COMPARE_LAPS) break;
  }
  return out;
}

export function slotsFromComparisonItems(
  items: ComparisonItem[],
): CompareSlotParam[] {
  return items.map((item) => ({
    sessionId: item.session_id,
    lapId: item.lap_id,
  }));
}

export function comparisonItemsFromSlots(
  slots: Array<{
    sessionId: string;
    lapId: string;
    lapNumber?: number;
    color?: string;
    offsetSec?: number;
    videoId?: string;
  }>,
): ComparisonItem[] {
  return normalizeComparisonItems(
    slots.map((slot, index) => ({
      session_id: slot.sessionId,
      lap_id: slot.lapId,
      lap_number: slot.lapNumber,
      color: slot.color ?? COMPARE_COLORS[index % COMPARE_COLORS.length],
      offset_sec: slot.offsetSec,
      video_id: slot.videoId,
    })),
  );
}

export function defaultComparisonTitle(items: ComparisonItem[]): string {
  if (!items.length) return "Untitled comparison";
  const labels = items
    .map((item) =>
      item.lap_number != null ? `L${item.lap_number}` : item.lap_id.slice(0, 6),
    )
    .slice(0, 4);
  return `Compare ${labels.join(" · ")}`;
}

export function comparisonSharePath(id: string) {
  return `/compare/${id}`;
}

/** Minimal lap identity for resolving saved comparison slots after re-parse. */
export type ComparisonLapIdentity = {
  id: string;
  session_id: string;
  lap_number: number;
};

/**
 * Resolve a comparison item to a live lap id.
 * Prefer exact lap_id; if that row was deleted/recreated (re-parse), fall back
 * to session_id + lap_number so public/owner views keep working.
 */
export function resolveComparisonItemLapId(
  item: ComparisonItem,
  laps: ComparisonLapIdentity[],
): string | null {
  const byId = laps.find(
    (lap) => lap.id === item.lap_id && lap.session_id === item.session_id,
  );
  if (byId) return byId.id;
  if (item.lap_number == null) return null;
  const byNumber = laps.find(
    (lap) =>
      lap.session_id === item.session_id &&
      lap.lap_number === item.lap_number,
  );
  return byNumber?.id ?? null;
}

/**
 * Map saved comparison items onto currently loaded laps.
 * Stale lap_ids (post re-parse) remapped via lap_number when present.
 */
export function resolveComparisonItemsAgainstLaps(
  items: ComparisonItem[],
  laps: ComparisonLapIdentity[],
): {
  resolved: ComparisonItem[];
  missing: ComparisonItem[];
  remappedCount: number;
} {
  const resolved: ComparisonItem[] = [];
  const missing: ComparisonItem[] = [];
  let remappedCount = 0;
  for (const item of items) {
    const lapId = resolveComparisonItemLapId(item, laps);
    if (!lapId) {
      missing.push(item);
      continue;
    }
    if (lapId !== item.lap_id) remappedCount += 1;
    resolved.push({ ...item, lap_id: lapId });
  }
  return { resolved, missing, remappedCount };
}

/**
 * After a session re-parse recreates lap rows, rewrite comparison items that
 * pointed at the old lap ids using lap_number continuity (same as videos).
 */
export function remapComparisonItemsByLapNumber(
  items: ComparisonItem[],
  sessionId: string,
  previousLapIdToNumber: Map<string, number>,
  nextLapNumberToId: Map<number, string>,
): { items: ComparisonItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((item) => {
    if (item.session_id !== sessionId) return item;
    const lapNumber =
      item.lap_number ?? previousLapIdToNumber.get(item.lap_id) ?? null;
    if (lapNumber == null) return item;
    const nextId = nextLapNumberToId.get(lapNumber);
    if (!nextId) return item;
    if (nextId === item.lap_id && item.lap_number === lapNumber) return item;
    changed = true;
    return { ...item, lap_id: nextId, lap_number: lapNumber };
  });
  return { items: changed ? normalizeComparisonItems(next) : items, changed };
}

export function parseComparisonRow(row: Record<string, unknown>): ComparisonRow {
  const items = normalizeComparisonItems(row.items);
  const reference_index = Math.max(
    0,
    Math.min(
      items.length ? items.length - 1 : 0,
      typeof row.reference_index === "number" ? row.reference_index : 0,
    ),
  );
  const analysis_mode: GpsDisplayMode =
    row.analysis_mode === "raw" ? "raw" : "snapped";
  const visibility: SessionVisibility =
    row.visibility === "private" ||
    row.visibility === "friends" ||
    row.visibility === "public"
      ? row.visibility
      : "public";
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    title: typeof row.title === "string" && row.title.trim()
      ? row.title.trim()
      : defaultComparisonTitle(items),
    description:
      typeof row.description === "string" ? row.description : null,
    visibility,
    items,
    reference_index,
    analysis_mode,
    cursor_state:
      row.cursor_state && typeof row.cursor_state === "object"
        ? (row.cursor_state as ComparisonCursorState)
        : null,
    forked_from:
      typeof row.forked_from === "string" ? row.forked_from : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}
