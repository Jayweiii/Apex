"use client";

import { saveLocalSession } from "@/lib/local-store";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { createClient } from "@/lib/supabase/client";
import { popularTracks } from "@/lib/tracks";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useState } from "react";

export function SessionUpload({
  storage = "supabase",
  trackId,
}: {
  storage?: "supabase" | "local";
  trackId?: string;
}) {
  const router = useRouter();
  const local = storage === "local";
  const [pickedTrack, setPickedTrack] = useState(trackId ?? "");
  const [name, setName] = useState("");
  const [car, setCar] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosenTrack = trackId ?? pickedTrack;

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    if (next && !name) {
      setName(next.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " "));
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a CSV telemetry file");
      return;
    }

    setBusy(true);
    try {
      const csv = await file.text();
      const laps = parseTelemetryCsv(csv);
      await saveSession(name.trim() || file.name, file.name, laps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveSession(
    sessionName: string,
    filename: string,
    laps: ReturnType<typeof parseTelemetryCsv>,
  ) {
    if (storage === "local") {
      if (!chosenTrack) throw new Error("Choose a track");
      const carName = car.trim();
      if (!carName) throw new Error("Enter the car");
      const session = saveLocalSession(sessionName, filename, laps, {
        trackId: chosenTrack,
        car: carName,
      });
      router.push(`/sessions/${session.id}`);
      router.refresh();
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) throw new Error("You need to be signed in");

    const { data: session, error: sessionError } = await supabase
      .from("sessions")
      .insert({
        user_id: user.id,
        name: sessionName,
        filename,
      })
      .select("id")
      .single();
    if (sessionError || !session) {
      throw new Error(sessionError?.message ?? "Could not create session");
    }

    const { error: lapsError } = await supabase.from("laps").insert(
      laps.map((lap) => ({
        session_id: session.id,
        user_id: user.id,
        lap_number: lap.lapNumber,
        lap_time_ms: lap.lapTimeMs,
        telemetry: lap.points,
      })),
    );
    if (lapsError) throw new Error(lapsError.message);

    router.push(`/sessions/${session.id}`);
    router.refresh();
  }

  async function loadSample() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/sample-telemetry.csv");
      if (!response.ok) throw new Error("Could not load the sample file");
      const csv = await response.text();
      const laps = parseTelemetryCsv(csv);
      await saveSession("Sample session", "sample-telemetry.csv", laps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the sample");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5"
    >
      <div className="mb-4">
        <h2 className="text-sm font-medium text-zinc-200">Upload telemetry</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {local
            ? "Saved in this browser on the track and car you choose. CSV with time, speed, and optionally lap, lat, and lon."
            : "CSV with time, speed, and optionally lap, lat, and lon."}
        </p>
      </div>
      <div className="grid gap-3">
        {local && !trackId ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Track</span>
            <select
              required
              value={pickedTrack}
              onChange={(event) => setPickedTrack(event.target.value)}
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
            >
              <option value="">Choose a track</option>
              {popularTracks().map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {local ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Car</span>
            <input
              required
              value={car}
              onChange={(e) => setCar(e.target.value)}
              placeholder="Porsche 911 GT3"
              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
            />
          </label>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">Session name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Laguna Seca — morning"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
        </label>
        <label className="flex cursor-pointer flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">CSV file</span>
          <span className="rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-zinc-300 hover:border-orange-500/60">
            {file ? file.name : "Choose file"}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="sr-only"
          />
        </label>
        </div>
      </div>
      {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
        >
          {busy ? "Parsing…" : "Upload session"}
        </button>
        <button
          type="button"
          onClick={loadSample}
          disabled={busy}
          className="text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline disabled:opacity-50"
        >
          Load sample session
        </button>
      </div>
    </form>
  );
}
