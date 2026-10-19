import { legacyLapRedirectHref } from "@/lib/session-lap-url";
import { redirect } from "next/navigation";

/**
 * Legacy per-lap routes redirect onto the session page with ?lap= selected.
 * Prefer /sessions/[id]?lap=N going forward.
 */
export default async function LapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; lapId: string }>;
  searchParams: Promise<{ v?: string; t?: string }>;
}) {
  const { id, lapId } = await params;
  const query = await searchParams;
  redirect(legacyLapRedirectHref(id, lapId, query));
}
