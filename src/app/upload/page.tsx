import { AppHeader } from "@/components/AppHeader";
import { SessionUpload } from "@/components/SessionUpload";
import { SiteFooter } from "@/components/SiteFooter";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Upload · Apex",
  description:
    "Upload TrackAddict, GoPro, VBO, GPX, or Dragy telemetry. Guests welcome.",
};

export default async function UploadPage() {
  let email: string | undefined;
  if (hasSupabaseConfig()) {
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      email = user?.email ?? undefined;
    } catch {
      email = undefined;
    }
  }

  return (
    <>
      <AppHeader email={email} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div>
          <Link
            href="/"
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            Home
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
            Upload a session
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            No account required. Guests save to the cloud; add an email later to
            keep sessions across devices.
          </p>
        </div>
        <SessionUpload />
      </main>
      <SiteFooter signedIn={Boolean(email)} />
    </>
  );
}
