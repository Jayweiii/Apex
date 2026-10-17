import { getCatalogSession } from "@/lib/catalog";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { isCloudSessionId } from "@/lib/visibility";

/** Catalog / demo / browser-local sessions skip the Supabase-backed pages. */
export function shouldUseLocalSession(id: string): boolean {
  if (!hasSupabaseConfig()) return true;
  if (getCatalogSession(id)) return true;
  if (isCloudSessionId(id)) return false;
  return id.startsWith("pub-") || id.startsWith("demo-");
}

export { isCloudSessionId };
