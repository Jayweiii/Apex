import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";

export const metadata = {
  title: "GoPro import · Apex",
  description:
    "How to import GoPro MP4 GPMF or Quik / Telemetry Overlay GPX/JSON/CSV into Apex.",
};

export default function GoProImportDocsPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-500">
            Docs
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            GoPro import
          </h1>
          <p className="text-sm text-zinc-400">
            Prefer GoPro GPS over phone CSV for speed, laps, and the track map.
            Telemetry is parsed in the browser so large videos are not uploaded
            wholesale.
          </p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">Supported inputs</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
            <li>
              <strong className="text-zinc-200">GoPro Hero5+ MP4 / LRV / MOV</strong>{" "}
              — GPMF extracted client-side (block File.slice, up to ~2GB, not
              uploaded wholesale). Uses GPS9 when present, else GPS5; drops
              unlocked (fix=0) samples. Session clock prefers GPS date/time,
              falling back to MP4 creation_time when GPS is missing/implausible.
              ACCL/GYRO when present.
            </li>
            <li>
              <strong className="text-zinc-200">Quik / Telemetry Overlay</strong>{" "}
              — GPX, JSON, or CSV export without the original MP4.
            </li>
            <li>
              <strong className="text-zinc-200">GPX / VBO / Dragy CSV</strong> —
              general GPS-logger imports (RaceLogic VBO, Dragy CSV with
              time/lat/lon/speed/heading/altitude).
            </li>
            <li>
              <strong className="text-zinc-200">Phone / TrackAddict CSV</strong> —
              still supported; ranked below GoPro and dedicated loggers in
              compare.
            </li>
            <li>
              <strong className="text-zinc-200">Dragy .dlap</strong> — not
              supported (encrypted). Export CSV/GPX/VBO from Dragy instead.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">Dragy .dlap</h2>
          <p className="text-sm text-zinc-400">
            Native <code className="text-zinc-300">.dlap</code> files are a zip
            with a PNG track map and an encrypted <code className="text-zinc-300">.group</code>{" "}
            blob Apex cannot read. In Dragy use Share / Export → CSV, GPX, or
            VBO. Dropping a <code className="text-zinc-300">.dlap</code> shows a
            clear message and may hint the track/date from the PNG name (e.g.{" "}
            <code className="text-zinc-300">
              ThunderhillRacewayParkWest_20261017161829.png
            </code>
            ).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">Export from Quik</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-400">
            <li>Open the clip in GoPro Quik.</li>
            <li>Export or share the GPS / telemetry track (GPX when available).</li>
            <li>
              In Apex → Upload, choose the file and pick the track so start/finish
              can auto-split laps.
            </li>
            <li>
              Optionally paste a YouTube URL for onboard sync instead of uploading
              the MP4.
            </li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">
            Export with Telemetry Overlay
          </h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-400">
            <li>Load the GoPro MP4 in Telemetry Overlay (or similar).</li>
            <li>
              Export GPX, JSON, or CSV with latitude, longitude, time, and speed.
            </li>
            <li>
              Upload in Apex — for CSV, check “GoPro Quik / Telemetry Overlay
              export”.
            </li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">MP4 behavior</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
            <li>
              Default: parse GPMF locally; save laps + GPS quality. Video stays on
              your device.
            </li>
            <li>
              Optional: upload MP4 to R2 (or IndexedDB) for onboard sync.
            </li>
            <li>
              Prefer linking YouTube when the onboard is already online.
            </li>
            <li>Multi-chapter: select several chapter MP4s together.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-zinc-100">Troubleshooting</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-400">
            <li>
              <strong className="text-zinc-200">No GPMF</strong> — use the
              original GoPro MP4 (YouTube strips metadata), or export GPX/JSON.
            </li>
            <li>
              <strong className="text-zinc-200">No GPS after filtering</strong> —
              enable GPS, wait for a 3D lock outdoors before recording.
            </li>
            <li>
              <strong className="text-zinc-200">No laps</strong> — drive a full
              lap past start/finish, or select the correct track.
            </li>
          </ul>
        </section>

        <p className="text-sm text-zinc-500">
          <Link href="/account" className="text-sky-300 underline underline-offset-2">
            Back to upload
          </Link>
          {" · "}
          Full markdown:{" "}
          <code className="text-zinc-400">docs/gopro-import.md</code>
        </p>
      </main>
    </>
  );
}
