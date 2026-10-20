import {
  isComparisonItem,
  normalizeComparisonItems,
  type ComparisonItem,
  type ComparisonRow,
} from "@/lib/comparisons";
import { isSessionOwner } from "@/lib/session-owner";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

export type SessionDeleteTarget = {
  id: string;
  name: string;
  user_id?: string | null;
};

/**
 * Remove deleted session ids from comparison items.
 * Returns remaining items and whether the comparison should be deleted
 * (< 2 laps left) vs kept with a missing slot marked at load time.
 */
export function scrubSessionsFromComparisonItems(
  items: ComparisonItem[],
  deletedSessionIds: Iterable<string>,
): {
  items: ComparisonItem[];
  removedCount: number;
  shouldDeleteComparison: boolean;
} {
  const gone = new Set(
    [...deletedSessionIds].map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  if (!gone.size) {
    return {
      items: normalizeComparisonItems(items),
      removedCount: 0,
      shouldDeleteComparison: false,
    };
  }
  const kept: ComparisonItem[] = [];
  let removedCount = 0;
  for (const item of items) {
    if (!isComparisonItem(item)) continue;
    if (gone.has(item.session_id.trim().toLowerCase())) {
      removedCount += 1;
      continue;
    }
    kept.push(item);
  }
  const normalized = normalizeComparisonItems(kept);
  return {
    items: normalized,
    removedCount,
    shouldDeleteComparison: normalized.length < 2,
  };
}

/** Owner gate used by UI + tests before calling Supabase delete. */
export function canDeleteSession(
  sessionUserId: string | null | undefined,
  authUserId: string | null | undefined,
): boolean {
  return isSessionOwner(sessionUserId, authUserId);
}

export type DeleteOwnedSessionsResult = {
  deletedIds: string[];
  comparisonsUpdated: number;
  comparisonsRemoved: number;
};

/**
 * Owner-only session delete.
 * Cascades laps + session_videos via FK. Scrubs the caller's comparisons
 * (remove items or delete comparison if <2 remain). Other users' comparisons
 * keep the orphaned session_id and surface as missing at load time.
 * Leaderboards / track stats recompute from remaining sessions automatically.
 */
export async function deleteOwnedSessions(
  client: SupabaseLike,
  authUserId: string,
  targets: SessionDeleteTarget[],
): Promise<DeleteOwnedSessionsResult> {
  if (!authUserId) throw new Error("Sign in to delete sessions");
  const unique = new Map<string, SessionDeleteTarget>();
  for (const target of targets) {
    if (!target?.id) continue;
    unique.set(target.id, target);
  }
  const list = [...unique.values()];
  if (!list.length) {
    return { deletedIds: [], comparisonsUpdated: 0, comparisonsRemoved: 0 };
  }

  for (const target of list) {
    if (target.user_id != null && !canDeleteSession(target.user_id, authUserId)) {
      throw new Error("Only the session owner can delete this session");
    }
  }

  const ids = list.map((t) => t.id);

  // Confirm rows are still owned (defense in depth; RLS also enforces).
  const { data: ownedRows, error: ownedError } = await client
    .from("sessions")
    .select("id, user_id, name")
    .in("id", ids)
    .eq("user_id", authUserId);
  if (ownedError) throw new Error(ownedError.message);
  const ownedIds = new Set(
    ((ownedRows ?? []) as Array<{ id: string }>).map((row) => row.id),
  );
  const missing = ids.filter((id) => !ownedIds.has(id));
  if (missing.length) {
    throw new Error("Only the session owner can delete this session");
  }

  let comparisonsUpdated = 0;
  let comparisonsRemoved = 0;

  // Scrub caller's saved comparisons that reference these sessions.
  try {
    const { data: comparisons, error: listError } = await client
      .from("comparisons")
      .select("id, items, reference_index")
      .eq("user_id", authUserId);
    if (listError) {
      // Table may be absent until Jason runs the comparisons migration.
      if (
        !/relation .*comparisons.* does not exist|Could not find the table/i.test(
          listError.message,
        )
      ) {
        throw new Error(listError.message);
      }
    } else {
      for (const row of (comparisons ?? []) as Array<{
        id: string;
        items: unknown;
        reference_index?: number;
      }>) {
        const items = normalizeComparisonItems(row.items);
        const scrubbed = scrubSessionsFromComparisonItems(items, ids);
        if (!scrubbed.removedCount) continue;
        if (scrubbed.shouldDeleteComparison) {
          const { error } = await client
            .from("comparisons")
            .delete()
            .eq("id", row.id)
            .eq("user_id", authUserId);
          if (error) throw new Error(error.message);
          comparisonsRemoved += 1;
        } else {
          const nextRef = Math.max(
            0,
            Math.min(
              scrubbed.items.length - 1,
              Number(row.reference_index ?? 0),
            ),
          );
          const { error } = await client
            .from("comparisons")
            .update({
              items: scrubbed.items,
              reference_index: nextRef,
            })
            .eq("id", row.id)
            .eq("user_id", authUserId);
          if (error) throw new Error(error.message);
          comparisonsUpdated += 1;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error) throw err;
    throw new Error("Could not update comparisons after session delete");
  }

  const { error: deleteError } = await client
    .from("sessions")
    .delete()
    .in("id", ids)
    .eq("user_id", authUserId);
  if (deleteError) throw new Error(deleteError.message);

  return {
    deletedIds: ids,
    comparisonsUpdated,
    comparisonsRemoved,
  };
}

/** Single-session helper. */
export async function deleteOwnedSession(
  client: SupabaseLike,
  authUserId: string,
  target: SessionDeleteTarget,
): Promise<DeleteOwnedSessionsResult> {
  return deleteOwnedSessions(client, authUserId, [target]);
}

/** Pure helper for tests: mark comparison items missing after a delete. */
export function markMissingComparisonItems(
  items: ComparisonItem[],
  availableSessionIds: Iterable<string>,
): {
  available: ComparisonItem[];
  missing: ComparisonItem[];
} {
  const ok = new Set(
    [...availableSessionIds].map((id) => id.trim().toLowerCase()),
  );
  const available: ComparisonItem[] = [];
  const missing: ComparisonItem[] = [];
  for (const item of items) {
    if (ok.has(item.session_id.trim().toLowerCase())) available.push(item);
    else missing.push(item);
  }
  return { available, missing };
}

export type { ComparisonRow };
