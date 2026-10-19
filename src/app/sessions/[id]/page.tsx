import { CloudSessionView } from "@/components/CloudSessionView";
import { LocalSession } from "@/components/LocalGarage";
import { shouldUseLocalSession } from "@/lib/session-route";
import { Suspense } from "react";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (shouldUseLocalSession(id)) {
    return (
      <Suspense
        fallback={<p className="p-8 text-sm text-zinc-500">Loading session…</p>}
      >
        <LocalSession id={id} />
      </Suspense>
    );
  }

  // Cloud UUIDs load with the browser Supabase client so auth cookies that
  // worked for upload also work for viewing (SSR cookie miss → LocalSession
  // "not found in this browser" was the production bug).
  return (
    <Suspense
      fallback={<p className="p-8 text-sm text-zinc-500">Loading session…</p>}
    >
      <CloudSessionView id={id} />
    </Suspense>
  );
}
