import { getCatalogSession } from "@/lib/catalog";
import { hasSupabaseConfig } from "@/lib/supabase/env";

/** Catalog / demo / browser-local sessions skip the Supabase-backed pages. */
export function shouldUseLocalSession(id: string): boolean {
  if (!hasSupabaseConfig()) return true;
  if (getCatalogSession(id)) return true;
  return id.startsWith("pub-") || id.startsWith("demo-");
}
