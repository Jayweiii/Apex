import {
  defaultComparisonTitle,
  normalizeComparisonItems,
  parseComparisonRow,
  remapComparisonItemsByLapNumber,
  type ComparisonDraft,
  type ComparisonItem,
  type ComparisonRow,
} from "@/lib/comparisons";
import type { SessionVisibility } from "@/lib/visibility";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseLike = any;

const SELECT_COLS =
  "id, user_id, title, description, visibility, items, reference_index, analysis_mode, cursor_state, forked_from, created_at, updated_at";

export async function fetchComparison(
  client: SupabaseLike,
  id: string,
): Promise<ComparisonRow | null> {
  const { data, error } = await client
    .from("comparisons")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return parseComparisonRow(data as Record<string, unknown>);
}

export async function listMyComparisons(
  client: SupabaseLike,
  userId: string,
): Promise<ComparisonRow[]> {
  const { data, error } = await client
    .from("comparisons")
    .select(SELECT_COLS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) =>
    parseComparisonRow(row),
  );
}

export async function listPublicComparisons(
  client: SupabaseLike,
  limit = 40,
): Promise<ComparisonRow[]> {
  const { data, error } = await client
    .from("comparisons")
    .select(SELECT_COLS)
    .eq("visibility", "public")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: Record<string, unknown>) =>
    parseComparisonRow(row),
  );
}

export async function insertComparison(
  client: SupabaseLike,
  userId: string,
  draft: ComparisonDraft,
): Promise<ComparisonRow> {
  const items = normalizeComparisonItems(draft.items);
  if (items.length < 2) {
    throw new Error("Need at least two laps to save a comparison");
  }
  const reference_index = Math.max(
    0,
    Math.min(items.length - 1, draft.referenceIndex ?? 0),
  );
  const title =
    draft.title?.trim() || defaultComparisonTitle(items);
  const payload = {
    user_id: userId,
    title,
    description: draft.description?.trim() || null,
    visibility: draft.visibility ?? "friends",
    items,
    reference_index,
    analysis_mode: draft.analysisMode ?? "snapped",
    cursor_state: draft.cursorState ?? null,
    forked_from: draft.forkedFrom ?? null,
  };
  const { data, error } = await client
    .from("comparisons")
    .insert(payload)
    .select(SELECT_COLS)
    .single();
  if (error) {
    if (/relation .*comparisons.* does not exist|Could not find the table/i.test(error.message)) {
      throw new Error(
        "Run supabase/migrations/20261019_comparisons.sql in the Supabase SQL editor, then retry.",
      );
    }
    throw new Error(error.message);
  }
  return parseComparisonRow(data as Record<string, unknown>);
}

export async function updateComparison(
  client: SupabaseLike,
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    visibility: SessionVisibility;
    items: ComparisonDraft["items"];
    referenceIndex: number;
    analysisMode: ComparisonDraft["analysisMode"];
    cursorState: ComparisonDraft["cursorState"];
  }>,
): Promise<ComparisonRow> {
  const payload: Record<string, unknown> = {};
  if (patch.title != null) payload.title = patch.title.trim() || "Untitled comparison";
  if (patch.description !== undefined) {
    payload.description = patch.description?.trim() || null;
  }
  if (patch.visibility) payload.visibility = patch.visibility;
  if (patch.items) payload.items = normalizeComparisonItems(patch.items);
  if (patch.referenceIndex != null) payload.reference_index = patch.referenceIndex;
  if (patch.analysisMode) payload.analysis_mode = patch.analysisMode;
  if (patch.cursorState !== undefined) payload.cursor_state = patch.cursorState;

  const { data, error } = await client
    .from("comparisons")
    .update(payload)
    .eq("id", id)
    .select(SELECT_COLS)
    .single();
  if (error) throw new Error(error.message);
  return parseComparisonRow(data as Record<string, unknown>);
}

export async function forkComparison(
  client: SupabaseLike,
  userId: string,
  source: ComparisonRow,
): Promise<ComparisonRow> {
  return insertComparison(client, userId, {
    title: source.title.startsWith("Copy of ")
      ? source.title
      : `Copy of ${source.title}`,
    description: source.description ?? undefined,
    visibility: "private",
    items: source.items,
    referenceIndex: source.reference_index,
    analysisMode: source.analysis_mode,
    cursorState: source.cursor_state,
    forkedFrom: source.id,
  });
}

export async function deleteComparison(
  client: SupabaseLike,
  id: string,
): Promise<void> {
  const { error } = await client.from("comparisons").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * After re-parse recreates lap UUIDs, rewrite the caller's saved comparisons
 * that reference this session (RLS only allows updating own rows).
 */
export async function remapOwnComparisonsForSessionReparse(
  client: SupabaseLike,
  userId: string,
  sessionId: string,
  previousLapIdToNumber: Map<string, number>,
  nextLapNumberToId: Map<number, string>,
): Promise<number> {
  const { data, error } = await client
    .from("comparisons")
    .select("id, items")
    .eq("user_id", userId)
    .limit(200);
  if (error) {
    if (
      /relation .*comparisons.* does not exist|Could not find the table/i.test(
        error.message,
      )
    ) {
      return 0;
    }
    throw new Error(error.message);
  }

  let updated = 0;
  for (const row of (data ?? []) as Array<{ id: string; items: unknown }>) {
    const items = normalizeComparisonItems(row.items) as ComparisonItem[];
    if (!items.some((item) => item.session_id === sessionId)) continue;
    const remapped = remapComparisonItemsByLapNumber(
      items,
      sessionId,
      previousLapIdToNumber,
      nextLapNumberToId,
    );
    if (!remapped.changed) continue;
    const { error: updateError } = await client
      .from("comparisons")
      .update({ items: remapped.items })
      .eq("id", row.id)
      .eq("user_id", userId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    updated += 1;
  }
  return updated;
}
