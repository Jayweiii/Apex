import { AppHeader } from "@/components/AppHeader";
import { PixelMark } from "@/components/pixel/PixelMark";
import Link from "next/link";

export const metadata = { title: "Off track · Apex" };

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main id="main-content" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-5 px-4 py-16 text-center">
        <PixelMark size={72} />
        <p className="px-label text-orange-400">404 · Off track</p>
        <h1 className="text-4xl font-bold text-zinc-50">That page ran wide</h1>
        <p className="text-sm text-zinc-400">The link is wrong or the session was removed. Rejoin from one of these.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/" className="apex-btn apex-btn--primary apex-btn--cta">
            Home
          </Link>
          <Link href="/lap-comparisons" className="apex-btn apex-btn--cta">
            Lap comparisons
          </Link>
          <Link href="/tracks" className="apex-btn apex-btn--cta">
            Tracks
          </Link>
        </div>
      </main>
    </>
  );
}
