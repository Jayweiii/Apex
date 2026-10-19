import { AppHeader } from "@/components/AppHeader";
import { DiscoverComparisons } from "@/components/DiscoverComparisons";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export const metadata = {
  title: "Discover · Apex",
  description: "Public lap comparisons shared by Apex drivers.",
};

export default async function DiscoverPage() {
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
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            Home
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Discover
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Public comparisons anyone can open. Duplicate one to edit your own
            copy.
          </p>
        </div>
        <DiscoverComparisons />
      </main>
    </>
  );
}
