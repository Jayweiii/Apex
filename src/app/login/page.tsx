import { AppHeader } from "@/components/AppHeader";
import { AuthForm } from "@/components/AuthForm";
import { SiteFooter } from "@/components/SiteFooter";
import Link from "next/link";

export const metadata = {
  title: "Sign in · Apex",
  description: "Sign in or create an Apex account to keep sessions across devices.",
};

export default function LoginPage() {
  return (
    <>
      <AppHeader />
      <main className="apex-page apex-page--narrow items-center justify-center py-10 sm:py-14">
        <div className="w-full max-w-md">
          <p className="apex-eyebrow text-orange-400">Apex</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">
            Sign in
          </h1>
          <p className="mt-2 mb-6 text-sm leading-relaxed text-zinc-500">
            Save sessions to your account. Laps stay available in this browser
            either way.
          </p>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-5 sm:p-6">
            <AuthForm />
          </div>
          <Link
            href="/"
            className="apex-btn apex-btn--ghost mt-5 inline-flex"
          >
            Back to home
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
