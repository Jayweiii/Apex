import { AccountWorkbench } from "@/components/AccountWorkbench";
import { AppHeader } from "@/components/AppHeader";
import { SiteFooter } from "@/components/SiteFooter";
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
      <main id="main-content" className="apex-page apex-page--medium">
        <div>
          <Link href="/" className="apex-eyebrow">
            Home
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-50">
            My Sessions
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Uploads, comparisons, and friends. Friends-visible sessions stay
            private to people you accept.
          </p>
        </div>
        <AccountWorkbench />
      </main>
      <SiteFooter signedIn />
    </>
  );
}
