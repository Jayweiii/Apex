"use client";

import { DataKindBadge } from "@/components/Attribution";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { putLocalBlob } from "@/lib/blob-store";
import {
  listDrivers,
  listKnownCars,
  saveLocalSession,
} from "@/lib/local-store";
import { parseGoProChapters } from "@/lib/parse-gopro";
import {
  detectGoProExportKind,
  parseGoProExportFile,
} from "@/lib/parse-gopro-export";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { assertFileWithinLimits } from "@/lib/abuse-limits";
import { ensureSharedTrack, fetchSharedTracks } from "@/lib/cloud-tracks";
import type { GpsQuality } from "@/lib/gps-quality";
import {
  ensureAuthenticatedUser,
  isAnonymousUser,
} from "@/lib/guest-auth";
import { saveSessionToCloud } from "@/lib/save-session-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import { resolveTrackStartFinish } from "@/lib/track-start-finish";
import {
  listCustomTracks,
  listSharedTracksCache,
  popularTracks,
  saveCustomTrack,
  setSharedTracksCache,
  type Track,
} from "@/lib/tracks";
import { presignUpload, uploadToTarget } from "@/lib/storage/upload-client";
import type { ParsedLap, SessionVideo } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  defaultVisibilityForUser,
  type SessionVisibility,
} from "@/lib/visibility";
import { parseYouTubeId } from "@/lib/youtube";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";

const CAR_CLASSES = ["Open", "Spec Miata", "GR Cup", "GT4", "GT3", "Prototype"];
const NEW_TRACK = "__new_track__";
const NEW_CAR = "__new_car__";

type Destination = "checking" | "cloud" | "local" | "unavailable";

function isGoProTelemetryFile(name: string): boolean {
  const kind = detectGoProExportKind(name);
  return kind === "mp4" || kind === "gpx" || kind === "json";
}

export function SessionUpload({
  storage = "auto",
  trackId,
}: {
  /** auto = cloud via guest/email auth when Supabase is configured */
  storage?: "auto" | "supabase" | "local";
  trackId?: string;
}) {
  const router = useRouter();
  const [destination, setDestination] = useState<Destination>("checking");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [csvAsGoProExport, setCsvAsGoProExport] = useState(false);
  const [previewQuality, setPreviewQuality] = useState<GpsQuality | null>(null);
  const [visibility, setVisibility] =
    useState<SessionVisibility>(DEFAULT_VISIBILITY);
  const [visibilityTouched, setVisibilityTouched] = useState(false);
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
      // Cloud path is available without an email account — guest auth on submit.
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (cancelled) return;
        const guest = isAnonymousUser(user);
        setIsGuest(guest || !user);
        setUserEmail(user?.email ?? null);
        if (!visibilityTouched) {
          setVisibility(defaultVisibilityForUser(guest || !user));
        }
        setDestination("cloud");
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
  }, [storage, busy, visibilityTouched]);

  useEffect(() => {
    let cancelled = false;
    async function loadTracks() {
      const local = listCustomTracks();
      let shared: Track[] = listSharedTracksCache();
      if (hasSupabaseConfig()) {
        try {
          const supabase = createClient();
          shared = await fetchSharedTracks(supabase);
          if (!cancelled) setSharedTracksCache(shared);
        } catch {
          // Keep local + cached shared.
        }
      }
      if (cancelled) return;
      const merged: Track[] = [];
      for (const track of [...shared, ...local]) {
        if (!merged.some((item) => item.id === track.id)) merged.push(track);
      }
      setExtraTracks(merged);
      const cars = listKnownCars();
      setKnownCars(cars);
      setCarChoice((current) => {
        if (current) return current;
        return cars.length ? "" : NEW_CAR;
      });
    }
    const frame = window.requestAnimationFrame(() => {
      void loadTracks();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [busy]);

  const tracks = useMemo(
    () => popularTracks("", extraTracks),
    [extraTracks],
  );
  const drivers = useMemo(
    () => (typeof window === "undefined" ? [] : listDrivers()),
    [busy],
  );

  const primary = files[0] ?? null;
  const primaryKind = primary ? detectGoProExportKind(primary.name) : "unknown";
  const isMp4 = primaryKind === "mp4";
  const isGoProExport =
    primaryKind === "gpx" ||
    primaryKind === "json" ||
    (primaryKind === "csv" && csvAsGoProExport);
  const isGoPro = isMp4 || isGoProExport;
  const creatingTrack = !trackId && pickedTrack === NEW_TRACK;
  const creatingCar = carChoice === NEW_CAR;
  const useCloud = destination === "cloud";

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    setFiles(next);
    setError(null);
    setSavedBanner(null);
    setPreviewQuality(null);
    const first = next[0];
    if (first && !name) {
      setName(
        first.name
          .replace(/\.(csv|mp4|gpx|json)$/i, "")
          .replace(/[_-]+/g, " "),
      );
    }
    if (first && isGoProTelemetryFile(first.name)) {
      setCsvAsGoProExport(false);
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

    const kind = detectGoProExportKind(mainFile.name);
    // Never upload large MP4s as "raw" — telemetry is parsed client-side.
    // Small exports (GPX/JSON/CSV) can be stored for re-process.
    if (kind === "csv" || kind === "gpx" || kind === "json") {
      try {
        const contentType =
          kind === "json"
            ? "application/json"
            : kind === "gpx"
              ? "application/gpx+xml"
              : mainFile.type || "text/csv";
        const target = await presignUpload({
          filename: mainFile.name,
          contentType,
          kind: "raw",
          sessionId,
          bytes: mainFile.size,
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

    if (keepVideo && isMp4) {
      try {
        const target = await presignUpload({
          filename: mainFile.name,
          contentType: mainFile.type || "video/mp4",
          kind: "video",
          sessionId,
          bytes: mainFile.size,
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

  async function resolveTrackId(laps: ParsedLap[]): Promise<string> {
    if (trackId) return trackId;
    if (pickedTrack === NEW_TRACK) {
      const firstLapPoints = laps[0]?.points;
      if (useCloud) {
        setProgress("Saving shared track…");
        const supabase = createClient();
        await ensureAuthenticatedUser(supabase);
        const created = await ensureSharedTrack(supabase, {
          name: newTrackName,
          location: "Community",
          firstLapPoints,
        });
        const shared = await fetchSharedTracks(supabase).catch(() => [
          created,
          ...listSharedTracksCache(),
        ]);
        setSharedTracksCache(shared);
        setExtraTracks((current) => {
          const next = [...shared, ...listCustomTracks(), ...current];
          const deduped: Track[] = [];
          for (const item of next) {
            if (!deduped.some((row) => row.id === item.id)) deduped.push(item);
          }
          return deduped;
        });
        setPickedTrack(created.id);
        return created.id;
      }
      const created = saveCustomTrack(newTrackName);
      setExtraTracks((current) => {
        const next = [created, ...listCustomTracks(), ...current];
        const deduped: Track[] = [];
        for (const item of next) {
          if (!deduped.some((row) => row.id === item.id)) deduped.push(item);
        }
        return deduped;
      });
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
      setError("Supabase is not configured in this environment.");
      return;
    }
    if (!files.length) {
      setError("Choose a CSV, GoPro MP4, or Quik/Telemetry Overlay GPX/JSON/CSV");
      return;
    }
    if (creatingTrack && !newTrackName.trim()) {
      setError("Enter a name for the new track");
      return;
    }

    setBusy(true);
    setProgress("Parsing…");
    try {
      for (const file of files) {
        const kind = detectGoProExportKind(file.name);
        assertFileWithinLimits(file, kind === "mp4" ? "video" : "csv");
      }

      const trackForSf =
        trackId ||
        (pickedTrack && pickedTrack !== NEW_TRACK ? pickedTrack : null);
      const startFinish = resolveTrackStartFinish(trackForSf);

      let laps: ParsedLap[];
      let startedAtMs: number | undefined;
      let sessionDate: string | undefined;
      let sourceKind: "csv" | "gopro" = "csv";
      let gpsQuality: GpsQuality | null = null;

      if (isMp4) {
        setProgress("Extracting GoPro GPMF locally (video stays on device)…");
        const parsed = await parseGoProChapters(files, {
          onProgress: (percent) => {
            setProgress(
              `Extracting GoPro GPMF… ${Math.round(percent)}% (not uploading video unless checked)`,
            );
          },
          startFinish,
        });
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
        sourceKind = "gopro";
        gpsQuality = parsed.gpsQuality;
      } else if (isGoProExport) {
        setProgress("Parsing GoPro export…");
        const parsed = await parseGoProExportFile(files[0], files[0].name, {
          startFinish,
        });
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
        sourceKind = "gopro";
        gpsQuality = parsed.gpsQuality;
      } else {
        const csv = await files[0].text();
        const parsed = parseTelemetryCsv(csv);
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
        sourceKind = "csv";
      }
      setPreviewQuality(gpsQuality);

      const sessionId = crypto.randomUUID();
      setProgress(
        useCloud ? "Saving telemetry to cloud…" : "Saving in this browser…",
      );
      const stored = await storeRawAndMaybeVideo(sessionId, files);
      const resolvedTrack = await resolveTrackId(laps);
      const tags = carTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const carName = car.trim();
      if (!carName) throw new Error("Enter the car");

      const ytId = parseYouTubeId(youtubeUrl);
      const videos: SessionVideo[] = [];
      if (ytId) {
        videos.push({
          id: crypto.randomUUID(),
          provider: "youtube",
          youtubeId: ytId,
          offsetSec: 0,
          rate: 1,
          syncSource: sourceKind === "gopro" ? "auto" : "unsynced",
        });
      }
      if (stored.videoObjectKey || stored.videoLocalKey) {
        videos.push({
          id: crypto.randomUUID(),
          provider: "mp4",
          objectKey: stored.videoObjectKey ?? undefined,
          localKey: stored.videoLocalKey ?? undefined,
          offsetSec: 0,
          rate: 1,
          syncSource: sourceKind === "gopro" ? "auto" : "unsynced",
        });
      }

      if (useCloud) {
        const supabase = createClient();
        const user = await ensureAuthenticatedUser(supabase);
        const guest = isAnonymousUser(user);
        setIsGuest(guest);
        setUserEmail(user.email ?? null);
        const effectiveVisibility = visibilityTouched
          ? visibility
          : defaultVisibilityForUser(guest);

        const uploadBytes = isMp4 && !keepVideo
          ? 0
          : files.reduce((sum, file) => sum + file.size, 0);
        const check = await fetch("/api/uploads/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            bytes: uploadBytes || Math.min(
              files.reduce((sum, file) => sum + file.size, 0),
              1024 * 1024,
            ),
            kind: keepVideo && isMp4 ? "video" : "session",
          }),
        });
        if (!check.ok) {
          const payload = (await check.json().catch(() => ({}))) as {
            error?: string;
          };
          // 401 before cookies settle — continue; saveSessionToCloud still rate-limits.
          if (check.status !== 401) {
            throw new Error(payload.error ?? "Upload rate limit");
          }
        }

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
          gpsQuality,
          rawObjectKey: stored.rawObjectKey,
          videoObjectKey: stored.videoObjectKey,
          storageBackend: stored.storageBackend,
          startedAtMs,
          sessionDate,
          visibility: effectiveVisibility,
          videos: videos.length ? videos : undefined,
        });
        setProgress("Saved");
        setSavedBanner(
          guest
            ? "Saved as a guest — open Account to add an email and keep sessions across devices."
            : "Saved to your account — opening session…",
        );
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
          gpsQuality,
          rawObjectKey: stored.rawObjectKey,
          videoObjectKey: stored.videoObjectKey,
          videoLocalKey: stored.videoLocalKey,
          storageBackend: stored.storageBackend,
          startedAtMs,
          sessionDate,
          videos: videos.length ? videos : undefined,
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
            Prefer GoPro GPS (MP4 GPMF or Quik/Telemetry Overlay GPX/JSON/CSV) —
            parsed in-browser so large videos stay off the server. Phone CSV
            still works. See{" "}
            <Link
              href="/docs/gopro-import"
              className="text-sky-300 underline underline-offset-2"
            >
              GoPro import guide
            </Link>
            .
          </p>
        </div>
        <DataKindBadge kind="upload" />
      </div>

      {destination === "cloud" ? (
        <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
          {userEmail
            ? `Signed in as ${userEmail}. `
            : isGuest
              ? "No account needed — uploads save as a guest (default Public link). "
              : "Uploads save to the cloud. "}
          Manage them under{" "}
          <Link href="/account" className="underline underline-offset-2">
            Account
          </Link>
          {userEmail ? null : (
            <>
              {" "}
              ·{" "}
              <Link href="/login" className="underline underline-offset-2">
                Add an email
              </Link>{" "}
              to keep sessions across devices
            </>
          )}
          .
        </p>
      ) : null}
      {destination === "local" ? (
        <p className="mb-4 rounded-xl border border-zinc-700/80 bg-zinc-900/60 px-3 py-2 text-sm text-zinc-400">
          Saving in this browser only (Supabase not configured).
        </p>
      ) : null}
      {destination === "unavailable" ? (
        <p className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Supabase env vars are missing in this environment.
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
                    {track.id.startsWith("custom-")
                      ? track.location === "Added in this browser"
                        ? " (this browser)"
                        : " (community)"
                      : ""}
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
            <span className="text-zinc-400">CSV · GoPro MP4 · GPX · JSON</span>
            <span className="flex min-h-12 items-center rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-zinc-300 hover:border-orange-500/60 sm:min-h-10 sm:py-2">
              {files.length
                ? files.map((file) => file.name).join(", ")
                : "Choose file(s)"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,video/mp4,.mp4,.gpx,application/gpx+xml,.json,application/json"
              multiple
              onChange={onFile}
              className="sr-only"
            />
          </label>
        </div>
        {primaryKind === "csv" ? (
          <label className="flex items-start gap-3 rounded-xl border border-zinc-800/80 px-3 py-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={csvAsGoProExport}
              onChange={(event) => setCsvAsGoProExport(event.target.checked)}
              className="mt-1"
            />
            <span>
              This CSV is a GoPro Quik / Telemetry Overlay export (auto-detect
              laps from track start/finish). Leave unchecked for TrackAddict /
              RaceRender phone CSV.
            </span>
          </label>
        ) : null}
        {isMp4 ? (
          <label className="flex items-start gap-3 rounded-xl border border-zinc-800/80 px-3 py-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={keepVideo}
              onChange={(event) => setKeepVideo(event.target.checked)}
              className="mt-1"
            />
            <span>
              Also upload the MP4 for onboard sync (optional; uses R2 when
              configured, otherwise IndexedDB). Telemetry is always extracted
              locally — large clips are not uploaded wholesale. Multi-chapter:
              select several MP4s together.
            </span>
          </label>
        ) : null}
        {isGoPro || isMp4 ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">
              YouTube URL for sync (optional)
            </span>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtu.be/… or paste video id"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
            <span className="text-xs text-zinc-500">
              Prefer linking YouTube instead of uploading a large MP4 when the
              onboard is already online.
            </span>
          </label>
        ) : null}
        {previewQuality || isGoPro ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <span>GPS source:</span>
            <GpsQualityBadge
              quality={previewQuality}
              sourceKind={isGoPro ? "gopro" : "csv"}
            />
          </div>
        ) : null}
        {useCloud ? (
          <SessionVisibilityControl
            value={visibility}
            onChange={(next) => {
              setVisibilityTouched(true);
              setVisibility(next);
            }}
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
