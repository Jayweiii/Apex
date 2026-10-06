import { hasSupabaseConfig, createClient } from "@/lib/supabase/client";

export type AccountSessionSummary = {
  id: string;
  name: string;
  trackId: string;
  trackName: string;
  car: string;
  best: number;
  laps: number;
};

type SessionFields = {
  id: string;
  name: string;
  track_id: string | null;
  track_name: string | null;
  car: string | null;
};

export async function listAccountSessions(): Promise<AccountSessionSummary[]> {
  if (!hasSupabaseConfig()) return [];
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("sessions")
    .select("id, name, track_id, track_name, car")
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  const sessions = data as SessionFields[];
  const ids = sessions.map((session) => session.id);
  const { data: laps } = ids.length
    ? await supabase.from("laps").select("session_id, lap_time_ms").in("session_id", ids)
    : { data: [] as { session_id: string; lap_time_ms: number }[] };

  const bySession = new Map<string, number[]>();
  for (const lap of laps ?? []) {
    const times = bySession.get(lap.session_id) ?? [];
    times.push(lap.lap_time_ms);
    bySession.set(lap.session_id, times);
  }

  return sessions
    .filter((session) => session.track_id)
    .map((session) => {
      const times = bySession.get(session.id) ?? [];
      return {
        id: session.id,
        name: session.name,
        trackId: session.track_id as string,
        trackName: session.track_name?.trim() || session.track_id || "Track",
        car: session.car?.trim() || "Unknown",
        best: times.length ? Math.min(...times) : Number.POSITIVE_INFINITY,
        laps: times.length,
      };
    });
}
