import { AppHeader } from "@/components/AppHeader";
import { LapCharts } from "@/components/LapCharts";
import { LocalLap } from "@/components/LocalGarage";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { LapRow, SessionRow, TelemetryPoint } from "@/lib/types";
import Link from "next/link";

export default async function LapPage({
  params,
}: {
  params: Promise<{ id: string; lapId: string }>;
}) {
  const { id, lapId } = await params;
  if (id.startsWith("pub-") || !hasSupabaseConfig()) {
    return <LocalLap sessionId={id} lapId={lapId} />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: session } = user
    ? await supabase.from("sessions").select("*").eq("id", id).maybeSingle()
    : { data: null };
  if (!user || !session) return <LocalLap sessionId={id} lapId={lapId} />;
  const sessionRow = session as SessionRow;

  const { data: lap } = await supabase
    .from("laps")
    .select("*")
    .eq("id", lapId)
    .eq("session_id", id)
    .maybeSingle();
  if (!lap) return <LocalLap sessionId={id} lapId={lapId} />;
  const lapRow = lap as LapRow;
  const points = (lapRow.telemetry ?? []) as TelemetryPoint[];
  const peak = points.reduce((max, point) => Math.max(max, point.speed), 0);

  const { data: siblings } = await supabase
    .from("laps")
    .select("id, lap_time_ms")
    .eq("session_id", id);
  const href = compareHref(
    sessionRow.id,
    (siblings ?? []) as { id: string; lap_time_ms: number }[],
    lapRow.id,
  );

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <Link
            href={`/sessions/${sessionRow.id}`}
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {sessionRow.name}
          </Link>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                Lap {lapRow.lap_number}
              </h1>
              <p className="mt-1 font-mono text-3xl text-orange-400">
                {formatLapTime(lapRow.lap_time_ms)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <p className="text-sm text-zinc-500">Peak {peak.toFixed(0)} km/h</p>
              {href ? (
                <Link
                  href={href}
                  className="text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
                >
                  Compare laps
                </Link>
              ) : null}
            </div>
          </div>
        </div>
        {points.length ? (
          <LapCharts points={points} label={`Lap ${lapRow.lap_number}`} />
        ) : (
          <p className="text-sm text-zinc-500">No speed samples on this lap.</p>
        )}
      </main>
    </>
  );
}
