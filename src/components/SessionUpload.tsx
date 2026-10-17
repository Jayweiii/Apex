"use client";

import { DataKindBadge } from "@/components/Attribution";
import { putLocalBlob } from "@/lib/blob-store";
import {
  listDrivers,
  listKnownCars,
  saveLocalSession,
} from "@/lib/local-store";
import { parseGoProChapters } from "@/lib/parse-gopro";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { saveSessionToCloud } from "@/lib/save-session-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import {
  listCustomTracks,
  popularTracks,
  saveCustomTrack,
  type Track,
} from "@/lib/tracks";
import { presignUpload, uploadToTarget } from "@/lib/storage/upload-client";
import {
  DEFAULT_VISIBILITY,
  type SessionVisibility,
} from "@/lib/visibility";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

const CAR_CLASSES = ["Open", "Spec Miata", "GR Cup", "GT4", "GT3", "Prototype"];
const NEW_TRACK = "__new_track__";
const NEW_CAR = "__new_car__";

type Destination = "checking" | "cloud" | "local" | "unavailable";

export function SessionUpload({
  storage = "auto",
  trackId,
}: {
  /** auto = Supabase when signed in, else local browser storage */
  storage?: "auto" | "supabase" | "local";
  trackId?: string;
}) {
  const router = useRouter();
  const [destination, setDestination] = useState<Destination>("checking");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [customTracks, setCustomTracks] = useState<Track[]>([]);
  const [pickedTrack, setPickedTrack] = useState(trackId ?? "");
  const [newTrackName, setNewTrackName] = useState("");
  const [name, setName] = useState("");
  const [car, setCar] = useState("");
  const [carChoice, setCarChoice] = useState("");
  const [knownCars, setKnownCars] = useState<string[]>([]);
  const [carClass, setCarClass] = useState("Open");
  const [carTags, setCarTags] = useState("");
  const [driver, setDriver] = useState("");
  const [weather, setWeather] = useState("");
  const [tires, setTires] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [keepVideo, setKeepVideo] = useState(false);
  const [visibility, setVisibility] =
    useState<SessionVisibility>(DEFAULT_VISIBILITY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function resolveDestination() {
      if (storage === "local") {
        if (!cancelled) setDestination("local");
        return;
      }
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setDestination(storage === "supabase" ? "unavailable" : "local");
        }
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        if (user) {
          setUserEmail(user.email ?? null);
          setDestination("cloud");
        } else if (storage === "supabase") {
          setDestination("unavailable");
        } else {
          setDestination("local");
        }
      } catch {
        if (!cancelled) {
          setDestination(storage === "supabase" ? "unavailable" : "local");
        }
      }
    }
    resolveDestination();
    return () => {
      cancelled = true;
    };
  }, [storage, busy]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setCustomTracks(listCustomTracks());
      const cars = listKnownCars();
      setKnownCars(cars);
      setCarChoice((current) => {
        if (current) return current;
        return cars.length ? "" : NEW_CAR;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [busy]);

  const tracks = useMemo(
    () => popularTracks("", customTracks),
    [customTracks],
  );
  const chosenTrack = trackId ?? (pickedTrack === NEW_TRACK ? "" : pickedTrack);
  const drivers = useMemo(
    () => (typeof window === "undefined" ? [] : listDrivers()),
    [busy],
  );

  const primary = files[0] ?? null;
  const isGoPro = Boolean(primary && /\.mp4$/i.test(primary.name));
  const creatingTrack = !trackId && pickedTrack === NEW_TRACK;
  const creatingCar = carChoice === NEW_CAR;
  const useCloud = destination === "cloud";

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    setFiles(next);
    setError(null);
    setSavedBanner(null);
    if (next[0] && !name) {
      setName(next[0].name.replace(/\.(csv|mp4)$/i, "").replace(/[_-]+/g, " "));
    }
  }

  function onCarChoice(value: string) {
    setCarChoice(value);
    if (value === NEW_CAR) {
      setCar("");
      return;
    }
    setCar(value);
  }

  async function storeRawAndMaybeVideo(sessionId: string, fileList: File[]) {
    const mainFile = fileList[0];
    let rawObjectKey: string | null = null;
    let videoObjectKey: string | null = null;
    let videoLocalKey: string | null = null;
    let storageBackend: "r2" | "local" | "idb" = "local";

    if (/\.csv$/i.test(mainFile.name)) {
      try {
        const target = await presignUpload({
          filename: mainFile.name,
          contentType: mainFile.type || "text/csv",
          kind: "raw",
          sessionId,
        });
        await uploadToTarget(target, mainFile);
        rawObjectKey = target.key;
        storageBackend = target.backend;
      } catch {
        const key = `local/${sessionId}/raw/${mainFile.name}`;
        await putLocalBlob(key, mainFile);
        rawObjectKey = key;
        storageBackend = "idb";
      }
    }

    if (keepVideo && isGoPro) {
      try {
        const target = await presignUpload({
          filename: mainFile.name,
          contentType: mainFile.type || "video/mp4",
          kind: "video",
          sessionId,
        });
        await uploadToTarget(target, mainFile);
        videoObjectKey = target.key;
        storageBackend = target.backend;
      } catch {
        const key = `local/${sessionId}/video/${mainFile.name}`;
        await putLocalBlob(key, mainFile);
        videoLocalKey = key;
        storageBackend = "idb";
      }
    }

    return { rawObjectKey, videoObjectKey, videoLocalKey, storageBackend };
  }

  async function resolveTrackId(): Promise<string> {
    if (trackId) return trackId;
    if (pickedTrack === NEW_TRACK) {
      const created = saveCustomTrack(newTrackName);
      setCustomTracks(listCustomTracks());
      setPickedTrack(created.id);
      return created.id;
    }
    if (!pickedTrack) throw new Error("Choose a track");
    return pickedTrack;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSavedBanner(null);
    if (destination === "unavailable") {
      setError("Sign in to save sessions to the server.");
      return;
    }
    if (!files.length) {
      setError("Choose a CSV or GoPro MP4 file");
      return;
    }
    if (creatingTrack && !newTrackName.trim()) {
      setError("Enter a name for the new track");
      return;
    }

    setBusy(true);
    setProgress("Parsing…");
    try {
      let laps;
      let startedAtMs: number | undefined;
      let sessionDate: string | undefined;
      let sourceKind: "csv" | "gopro" = "csv";
      if (isGoPro) {
        setProgress("Extracting GoPro GPMF…");
        const parsed = await parseGoProChapters(files, (percent) => {
          setProgress(`Extracting GoPro GPMF… ${Math.round(percent)}%`);
        });
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
        sourceKind = "gopro";
      } else {
        const csv = await files[0].text();
        const parsed = parseTelemetryCsv(csv);
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
      }

      const sessionId = crypto.randomUUID();
      setProgress(
        useCloud ? "Saving to your account…" : "Saving in this browser…",
      );
      const stored = await storeRawAndMaybeVideo(sessionId, files);
      const resolvedTrack = await resolveTrackId();
      const tags = carTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const carName = car.trim();
      if (!carName) throw new Error("Enter the car");

      if (useCloud) {
        const supabase = createClient();
        const result = await saveSessionToCloud(supabase, laps, {
          id: sessionId,
          name: name.trim() || files[0].name,
          filename: files.map((file) => file.name).join(", "),
          trackId: resolvedTrack,
          car: carName,
          carClass,
          carTags: tags,
          driver: driver.trim() || undefined,
          weather: weather.trim() || undefined,
          tires: tires.trim() || undefined,
          notes: notes.trim() || undefined,
          sourceKind,
          rawObjectKey: stored.rawObjectKey,
          videoObjectKey: stored.videoObjectKey,
          storageBackend: stored.storageBackend,
          startedAtMs,
          sessionDate,
          visibility,
        });
        setProgress("Saved to server");
        setSavedBanner("Saved to your account — opening session…");
        router.push(`/sessions/${result.sessionId}`);
        router.refresh();
        return;
      }

      const session = saveLocalSession(
        name.trim() || files[0].name,
        files.map((file) => file.name).join(", "),
        laps,
        {
          id: sessionId,
          trackId: resolvedTrack,
          car: carName,
          carClass,
          carTags: tags,
          driver: driver.trim() || undefined,
          weather: weather.trim() || undefined,
          tires: tires.trim() || undefined,
          notes: notes.trim() || undefined,
          sourceKind,
          rawObjectKey: stored.rawObjectKey,
          videoObjectKey: stored.videoObjectKey,
          videoLocalKey: stored.videoLocalKey,
          storageBackend: stored.storageBackend,
          startedAtMs,
          sessionDate,
        },
      );
      setSavedBanner("Saved in this browser (local only)");
      router.push(`/sessions/${session.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-4 sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Upload telemetry</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-500">
            CSV (TrackAddict / RaceRender) or GoPro MP4 with GPMF GPS. Pick an
            existing track/car or create a new one.
          </p>
        </div>
        <DataKindBadge kind="upload" />
      </div>

      {destination === "cloud" ? (
        <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          Signed in{userEmail ? ` as ${userEmail}` : ""}. Uploads save to your
          account and show up under{" "}
          <Link href="/account" className="underline underline-offset-2">
            Account
          </Link>{" "}
          and{" "}
          <Link href="/friends" className="underline underline-offset-2">
            Friends
          </Link>
          .
        </p>
      ) : null}
      {destination === "local" ? (
        <p className="mb-4 rounded-xl border border-zinc-700/80 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
          Saving in this browser only.{" "}
          <Link
            href="/login"
            className="text-orange-400 underline-offset-2 hover:underline"
          >
            Sign in to save to the server and share with friends
          </Link>
          .
        </p>
      ) : null}
      {destination === "unavailable" ? (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <Link href="/login" className="font-medium underline underline-offset-2">
            Sign in
          </Link>{" "}
          to save sessions to the server.
        </p>
      ) : null}

      <div className="grid gap-3">
        {!trackId ? (
          <div className="grid gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-zinc-400">Track</span>
              <select
                required
                value={pickedTrack}
                onChange={(event) => setPickedTrack(event.target.value)}
                className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
              >
                <option value="">Choose a track</option>
                {tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                    {track.id.startsWith("custom-") ? " (yours)" : ""}
                  </option>
                ))}
                <option value={NEW_TRACK}>+ Create new track…</option>
              </select>
            </label>
            {creatingTrack ? (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-zinc-400">New track name</span>
                <input
                  required
                  value={newTrackName}
                  onChange={(event) => setNewTrackName(event.target.value)}
                  placeholder="Thunderhill West"
                  className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
                />
              </label>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-zinc-400">Car</span>
              <select
                required
                value={carChoice}
                onChange={(event) => onCarChoice(event.target.value)}
                className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
              >
                <option value="" disabled={knownCars.length === 0}>
                  Choose a car
                </option>
                {knownCars.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                <option value={NEW_CAR}>+ Create new car…</option>
              </select>
            </label>
            {creatingCar ? (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-zinc-400">New car name</span>
                <input
                  required
                  value={car}
                  onChange={(event) => setCar(event.target.value)}
                  placeholder="NA Miata"
                  className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
                />
              </label>
            ) : null}
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Class</span>
            <select
              value={carClass}
              onChange={(event) => setCarClass(event.target.value)}
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            >
              {CAR_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Driver</span>
            <input
              list="apex-drivers"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="Alex"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
            <datalist id="apex-drivers">
              {drivers.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Car tags</span>
            <input
              value={carTags}
              onChange={(e) => setCarTags(e.target.value)}
              placeholder="205 tires, stock sway"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Weather</span>
            <input
              value={weather}
              onChange={(e) => setWeather(e.target.value)}
              placeholder="Dry, 18°C, light wind"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Tires</span>
            <input
              value={tires}
              onChange={(e) => setTires(e.target.value)}
              placeholder="RE-71RS, heat cycle 2"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-zinc-400">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Cold pressures 28/30, traffic in T5"
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:text-sm"
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">Session name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Thunderhill East — morning"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
          </label>
          <label className="flex cursor-pointer flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">CSV or GoPro MP4</span>
            <span className="flex min-h-12 items-center rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-zinc-300 hover:border-orange-500/60 sm:min-h-10 sm:py-2">
              {files.length
                ? files.map((file) => file.name).join(", ")
                : "Choose file(s)"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,video/mp4,.mp4"
              multiple
              onChange={onFile}
              className="sr-only"
            />
          </label>
        </div>
        {isGoPro ? (
          <label className="flex items-start gap-3 rounded-xl border border-zinc-800/80 px-3 py-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={keepVideo}
              onChange={(event) => setKeepVideo(event.target.checked)}
              className="mt-1"
            />
            <span>
              Upload video for onboard sync (optional). Telemetry is extracted
              locally either way. Multi-chapter: select several MP4s together.
            </span>
          </label>
        ) : null}
        {useCloud ? (
          <SessionVisibilityControl
            value={visibility}
            onChange={setVisibility}
            disabled={busy}
            compact
          />
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      ) : null}
      {progress ? <p className="mt-3 text-sm text-zinc-400">{progress}</p> : null}
      {savedBanner ? (
        <p className="mt-3 text-sm text-emerald-300">{savedBanner}</p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || destination === "checking" || destination === "unavailable"}
          className="min-h-11 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
        >
          {busy
            ? useCloud
              ? "Saving to your account…"
              : "Saving…"
            : useCloud
              ? "Upload to account"
              : "Upload session"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/sessions/demo-laguna-seca-gt3")}
          disabled={busy}
          className="min-h-11 text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline disabled:opacity-50"
        >
          Open synthetic demo
        </button>
      </div>
    </form>
  );
}
