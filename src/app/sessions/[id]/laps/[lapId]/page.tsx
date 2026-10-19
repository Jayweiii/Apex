import { CloudLapView } from "@/components/CloudLapView";
import { LocalLap } from "@/components/LocalGarage";
import { shouldUseLocalSession } from "@/lib/session-route";
import { Suspense } from "react";

export default async function LapPage({
  params,
}: {
  params: Promise<{ id: string; lapId: string }>;
}) {
  const { id, lapId } = await params;
  if (shouldUseLocalSession(id)) {
    return (
      <Suspense fallback={<p className="p-8 text-sm text-zinc-500">Loading lap…</p>}>
        <LocalLap sessionId={id} lapId={lapId} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<p className="p-8 text-sm text-zinc-500">Loading lap…</p>}>
      <CloudLapView sessionId={id} lapId={lapId} />
    </Suspense>
  );
}
