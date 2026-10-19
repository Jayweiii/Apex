import { AppHeader } from "@/components/AppHeader";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";

export default async function FriendsSessionsPage() {
  if (!hasSupabaseConfig()) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
          <h1 className="text-2xl font-semibold text-zinc-50">Friends</h1>
          <p className="mt-3 text-sm text-zinc-400">
            Configure Supabase env vars to browse cloud sessions shared with
            friends and the public.
          </p>
        </main>
      </>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out visitors: RLS allows anon read of public rows. Signed-in:
  // friends + public + own. Never require login just to browse public data.
  let sessionsQuery = supabase
    .from("sessions")
    .select("id, name, track_id, car, driver_name, created_at, user_id, visibility")
    .order("created_at", { ascending: false })
    .limit(40);
  if (!user) {
    sessionsQuery = sessionsQuery.eq("visibility", "public");
  }

  const { data: sessions } = await sessionsQuery;

  const { data: videos } = await supabase
    .from("session_videos")
    .select("session_id, provider, youtube_id, title")
    .limit(200);

  const videoBySession = new Map<string, number>();
  for (const video of videos ?? []) {
    videoBySession.set(
      video.session_id,
      (videoBySession.get(video.session_id) ?? 0) + 1,
    );
  }

  return (
    <>
      <AppHeader email={user?.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            {user ? "Friends' sessions" : "Public sessions"}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            {user
              ? "Sessions set to Friends or Public link. Private sessions stay with their owner."
              : "Public cloud sessions anyone can open. Sign in to also see friends' shared sessions."}
          </p>
          {!user ? (
            <p className="mt-2 text-sm text-zinc-500">
              <Link href="/login" className="text-orange-400 hover:text-orange-300">
                Sign in
              </Link>{" "}
              when you want to upload, save, or change visibility.
            </p>
          ) : null}
        </div>
        {!sessions?.length ? (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No sessions yet, upload one.
          </p>
        ) : (
          <ul className="grid gap-3">
            {sessions.map((session) => {
              const track = session.track_id
                ? getTrack(session.track_id)
                : null;
              const mine = Boolean(user && session.user_id === user.id);
              return (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="block rounded-2xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-4 transition hover:border-zinc-700"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-100">
                          {session.name}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">
                          {track?.name ?? session.track_id ?? "Track"}
                          {session.car ? ` · ${session.car}` : ""}
                          {session.driver_name
                            ? ` · ${session.driver_name}`
                            : ""}
                          {mine ? " · you" : ""}
                          {session.visibility ? ` · ${session.visibility}` : ""}
                          {videoBySession.get(session.id)
                            ? ` · ${videoBySession.get(session.id)} video(s)`
                            : ""}
                        </p>
                      </div>
                      <p className="text-xs text-zinc-600">
                        {new Date(session.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
