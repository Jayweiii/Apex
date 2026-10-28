import {
  parseComparisonRow,
  type ComparisonRow,
} from "@/lib/comparisons";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Public comparisons for the home grid — fetched on the server so the first
 * paint does not wait on a client waterfalls.
 */
export async function fetchHomeComparisonsServer(
  limit = 6,
): Promise<ComparisonRow[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("comparisons")
      .select(
        "id, user_id, title, description, visibility, items, reference_index, analysis_mode, cursor_state, forked_from, created_at, updated_at",
      )
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((row) => parseComparisonRow(row as Record<string, unknown>));
  } catch {
    return [];
  }
}
