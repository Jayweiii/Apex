import { getCatalogSession } from "@/lib/catalog";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { isCloudSessionId } from "@/lib/visibility";

/** Browser-local (and any legacy catalog id) sessions skip Supabase pages. */
export function shouldUseLocalSession(id: string): boolean {
  if (!hasSupabaseConfig()) return true;
  if (getCatalogSession(id)) return true;
  if (isCloudSessionId(id)) return false;
  // Legacy pub-/demo- ids are not cloud UUIDs; treat as local/missing.
  return id.startsWith("pub-") || id.startsWith("demo-");
}

export { isCloudSessionId };
