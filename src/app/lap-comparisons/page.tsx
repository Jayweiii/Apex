import { AppHeader } from "@/components/AppHeader";
import { LapComparisonsPage } from "@/components/LapComparisonsPage";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";

export const metadata = {
  title: "Lap Comparisons · Apex",
  description: "Public lap comparisons and friends' shared sessions.",
};

export default async function LapComparisonsRoute() {
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
      <main id="main-content" className="apex-page apex-page--medium">
        <div>
          <Link href="/" className="apex-eyebrow">
            Home
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
            Lap Comparisons
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Public comparisons anyone can open, plus friends and public session
            feeds. Duplicate a comparison to edit your own copy.
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-sm text-zinc-500">Loading lap comparisons…</p>
          }
        >
          <LapComparisonsPage />
        </Suspense>
      </main>
    </>
  );
}
