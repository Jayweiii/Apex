import { AppHeader } from "@/components/AppHeader";
import { AuthForm } from "@/components/AuthForm";
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
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-orange-400">
            Apex
          </p>
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
      <footer className="mt-auto border-t border-zinc-900/90">
        <div className="mx-auto flex w-full max-w-6xl px-4 py-4 text-xs text-zinc-500 sm:px-6">
          <p>
            Apex · telemetry you upload stays yours. Map tiles ©{" "}
            <a
              href="https://www.esri.com/"
              target="_blank"
              rel="noreferrer"
              className="text-zinc-400 underline-offset-2 hover:text-orange-300 hover:underline"
            >
              Esri
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  );
}
