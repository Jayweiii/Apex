import { CloudSessionView } from "@/components/CloudSessionView";
import { LocalSession } from "@/components/LocalGarage";
import { shouldUseLocalSession } from "@/lib/session-route";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (shouldUseLocalSession(id)) {
    return <LocalSession id={id} />;
  }

  // Cloud UUIDs load with the browser Supabase client so auth cookies that
  // worked for upload also work for viewing (SSR cookie miss → LocalSession
  // "not found in this browser" was the production bug).
  return <CloudSessionView id={id} />;
}
