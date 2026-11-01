import Link from "next/link";

/** Slim site footer: attribution + sign-in. */
export function SiteFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="mt-auto border-t border-zinc-900/90">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 text-xs text-zinc-500 sm:px-6">
        <p>
          Apex · telemetry you upload stays yours. Map tiles ©{" "}
          <a
            href="https://www.esri.com/"
            target="_blank"
            rel="noreferrer"
            className="apex-hit text-zinc-400 underline-offset-2 hover:text-orange-300 hover:underline"
          >
            Esri
          </a>
          .
        </p>
        {signedIn ? (
          <Link
            href="/account"
            className="apex-hit text-zinc-400 underline-offset-2 hover:text-orange-300 hover:underline"
          >
            My Sessions
          </Link>
        ) : (
          <Link
            href="/login"
            className="apex-hit text-zinc-400 underline-offset-2 hover:text-orange-300 hover:underline"
          >
            Sign in
          </Link>
        )}
      </div>
    </footer>
  );
}
