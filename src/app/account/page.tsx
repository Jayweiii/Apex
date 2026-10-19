import { AccountSessions } from "@/components/AccountSessions";
import { AppHeader } from "@/components/AppHeader";
import { ImportLocalSessions } from "@/components/ImportLocalSessions";
import { SavedComparisonsList } from "@/components/SavedComparisonsList";
import { SessionUpload } from "@/components/SessionUpload";
import { hasSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AccountPage() {
  if (!hasSupabaseConfig()) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <AppHeader email={user.email} />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-8">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            Home
          </Link>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">
            Account sessions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Your uploads. Default visibility is Friends (signed-in Apex drivers).
            Change it on each session page.
          </p>
        </div>
        <ImportLocalSessions />
        <SessionUpload />
        <SavedComparisonsList />
        <AccountSessions />
      </main>
    </>
  );
}
