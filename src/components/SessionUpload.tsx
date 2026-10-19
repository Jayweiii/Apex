"use client";

import { DataKindBadge } from "@/components/Attribution";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { putLocalBlob } from "@/lib/blob-store";
import { readMp4CreationTime } from "@/lib/mp4-creation-time";
import {
  listDrivers,
  listKnownCars,
  saveLocalSession,
} from "@/lib/local-store";
import { parseGoProChapters } from "@/lib/parse-gopro";
import {
  detectGpsLoggerFormat,
  inspectDlap,
  isZipBytes,
  parseGpsLoggerFile,
  type DlapHints,
} from "@/lib/parse-gps-logger";
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
import type { SessionSourceKind } from "@/lib/local-store";
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

function extensionKind(name: string): string {
  const lower = name.toLowerCase();
  // GoPro media: full MP4, proxy LRV, and some MOV exports all carry GPMF.
  if (
    lower.endsWith(".mp4") ||
    lower.endsWith(".lrv") ||
    lower.endsWith(".mov")
  ) {
    return "mp4";
  }
  if (lower.endsWith(".dlap")) return "dlap";
  if (lower.endsWith(".vbo")) return "vbo";
  if (lower.endsWith(".gpx")) return "gpx";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".csv")) return "csv";
  return "unknown";
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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [csvAsGoProExport, setCsvAsGoProExport] = useState(false);
  const [previewQuality, setPreviewQuality] = useState<GpsQuality | null>(null);
  const [dlapHints, setDlapHints] = useState<DlapHints | null>(null);
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
  const primaryKind = primary ? extensionKind(primary.name) : "unknown";
  const isMp4 = primaryKind === "mp4";
  const isDlap = primaryKind === "dlap";
  const isLoggerExport =
    primaryKind === "gpx" ||
    primaryKind === "vbo" ||
    primaryKind === "json" ||
    (primaryKind === "csv" && csvAsGoProExport);
  const isDedicatedGps = isMp4 || isLoggerExport;
  const creatingTrack = !trackId && pickedTrack === NEW_TRACK;
  const creatingCar = carChoice === NEW_CAR;
  const useCloud = destination === "cloud";

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const next = Array.from(event.target.files ?? []);
    setFiles(next);
    setError(null);
    setSavedBanner(null);
    setPreviewQuality(null);
    setDlapHints(null);
    const first = next[0];
    if (first && !name) {
      setName(
        first.name
          .replace(/\.(csv|mp4|lrv|mov|gpx|json|vbo|dlap)$/i, "")
          .replace(/[_-]+/g, " "),
      );
    }
    if (first && /\.(mp4|gpx|json|vbo)$/i.test(first.name)) {
      setCsvAsGoProExport(false);
    }
    if (first && /\.dlap$/i.test(first.name)) {
      void (async () => {
        try {
          const bytes = new Uint8Array(await first.arrayBuffer());
          const hints = inspectDlap(bytes);
          setDlapHints(hints);
          setError(hints.message);
          if (hints.trackNameHint && creatingTrack && !newTrackName) {
            setNewTrackName(hints.trackNameHint);
          }
          if (hints.trackNameHint && !name) {
            setName(
              hints.sessionDateHint
                ? `${hints.trackNameHint} — ${hints.sessionDateHint}`
                : hints.trackNameHint,
            );
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not read .dlap");
        }
      })();
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

  /** Store small GPS exports for re-process. Never upload GoPro MP4/LRV/MOV. */
  async function storeRawExport(sessionId: string, fileList: File[]) {
    const mainFile = fileList[0];
    let rawObjectKey: string | null = null;
    let storageBackend: "r2" | "local" | "idb" = "local";

    const kind = extensionKind(mainFile.name);
    // Never upload MP4/LRV/MOV — telemetry is parsed client-side; onboard is YouTube.
    if (kind === "csv" || kind === "gpx" || kind === "json" || kind === "vbo") {
      try {
        const contentType =
          kind === "json"
            ? "application/json"
            : kind === "gpx"
              ? "application/gpx+xml"
              : kind === "vbo"
                ? "text/plain"
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

    return {
      rawObjectKey,
      videoObjectKey: null as string | null,
      videoLocalKey: null as string | null,
      storageBackend,
    };
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
      setError(
        "Choose a GoPro MP4, GPX, VBO, Dragy CSV, Quik JSON/CSV, or TrackAddict CSV",
      );
      return;
    }
    if (isDlap) {
      setError(
        dlapHints?.message ??
          "Dragy .dlap can’t be imported — export CSV, GPX, or VBO from Dragy instead.",
      );
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
        const kind = extensionKind(file.name);
        if (kind === "mp4") {
          // Local GPMF only — never uploaded. Cap ~2GB via File.slice parse.
          assertFileWithinLimits(file, "gopro-parse");
        } else {
          assertFileWithinLimits(file, "csv");
        }
      }

      const trackForSf =
        trackId ||
        (pickedTrack && pickedTrack !== NEW_TRACK ? pickedTrack : null);
      const startFinish = resolveTrackStartFinish(trackForSf);

      let laps: ParsedLap[];
      let startedAtMs: number | undefined;
      let sessionDate: string | undefined;
      let sourceKind: SessionSourceKind = "csv";
      let gpsQuality: GpsQuality | null = null;
      let videoStartedAtMs: number | undefined;

      if (isMp4) {
        setProgress("Reading MP4 creation_time (GPS clock preferred when present)…");
        try {
          const creation = await readMp4CreationTime(files[0]);
          videoStartedAtMs = creation.creationTimeMs ?? undefined;
        } catch {
          videoStartedAtMs = undefined;
        }
        setProgress("Extracting GoPro GPMF locally (video stays on device)…");
        const parsed = await parseGoProChapters(files, {
          onProgress: (percent) => {
            setProgress(
              `Extracting GoPro GPMF… ${Math.round(percent)}% (not uploading video unless checked)`,
            );
          },
          startFinish,
          // Fallback only — parseGoPro prefers plausible GPS-derived time.
          videoStartedAtMs,
        });
        laps = parsed.laps;
        startedAtMs = parsed.startedAtMs;
        sessionDate = parsed.sessionDate;
        // Align attached video wall-clock with the resolved session clock.
        if (parsed.startedAtMs != null) {
          videoStartedAtMs = parsed.startedAtMs;
        }
        sourceKind = "gopro";
        gpsQuality = parsed.gpsQuality;
      } else {
        setProgress("Detecting GPS log format…");
        const peek = await files[0].slice(0, 4).arrayBuffer();
        if (isZipBytes(new Uint8Array(peek))) {
          const bytes = new Uint8Array(await files[0].arrayBuffer());
          const hints = inspectDlap(bytes);
          setDlapHints(hints);
          throw new Error(hints.message);
        }

        const textPeek = await files[0].slice(0, 12000).text();
        const detected = csvAsGoProExport
          ? "gopro-csv"
          : detectGpsLoggerFormat(files[0].name, textPeek);

        if (detected === "trackaddict-csv" && !csvAsGoProExport) {
          setProgress("Parsing TrackAddict / RaceRender CSV…");
          const csv = await files[0].text();
          const parsed = parseTelemetryCsv(csv);
          laps = parsed.laps;
          startedAtMs = parsed.startedAtMs;
          sessionDate = parsed.sessionDate;
          sourceKind = "csv";
        } else {
          setProgress(
            detected === "vbo"
              ? "Parsing VBO…"
              : detected === "dragy-csv"
                ? "Parsing Dragy CSV…"
                : detected === "gpx"
                  ? "Parsing GPX…"
                  : "Parsing GPS export…",
          );
          try {
            const parsed = await parseGpsLoggerFile(files[0], files[0].name, {
              startFinish,
            });
            laps = parsed.laps;
            startedAtMs = parsed.startedAtMs;
            sessionDate = parsed.sessionDate;
            sourceKind =
              parsed.format === "gopro-json" || parsed.format === "gopro-csv"
                ? "gopro"
                : "logger";
            gpsQuality = parsed.gpsQuality;
          } catch (err) {
            if (
              err instanceof Error &&
              err.message === "TRACKADDICT_CSV"
            ) {
              const csv = await files[0].text();
              const parsed = parseTelemetryCsv(csv);
              laps = parsed.laps;
              startedAtMs = parsed.startedAtMs;
              sessionDate = parsed.sessionDate;
              sourceKind = "csv";
            } else {
              throw err;
            }
          }
        }
      }
      setPreviewQuality(gpsQuality);

      const sessionId = crypto.randomUUID();
      setProgress(
        useCloud ? "Saving telemetry to cloud…" : "Saving in this browser…",
      );
      const stored = await storeRawExport(sessionId, files);
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
          syncSource:
            sourceKind === "gopro" || sourceKind === "logger"
              ? "auto"
              : "unsynced",
          videoStartedAtMs,
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

        // GoPro media never counts toward upload bytes (telemetry-only).
        const uploadBytes = isMp4
          ? 0
          : files.reduce((sum, file) => sum + file.size, 0);
        const check = await fetch("/api/uploads/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            bytes:
              uploadBytes ||
              Math.min(
                files.reduce((sum, file) => sum + file.size, 0),
                1024 * 1024,
              ),
            kind: "session",
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
            Prefer GoPro or dedicated GPS loggers (GPX, VBO, Dragy CSV) —
            parsed in-browser so large videos stay off the server. TrackAddict
            phone CSV still works. Native Dragy{" "}
            <code className="text-zinc-400">.dlap</code> is not supported —
            export CSV/GPX/VBO instead. See{" "}
            <Link
              href="/docs/gopro-import"
              className="text-sky-300 underline underline-offset-2"
            >
              import guide
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
            <span className="text-zinc-400">
              CSV · MP4 · LRV · MOV · GPX · VBO · JSON · DLAP
            </span>
            <span className="flex min-h-12 items-center rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-zinc-300 hover:border-orange-500/60 sm:min-h-10 sm:py-2">
              {files.length
                ? files.map((file) => file.name).join(", ")
                : "Choose file(s)"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv,video/mp4,.mp4,.lrv,.mov,video/quicktime,.gpx,application/gpx+xml,.json,application/json,.vbo,.dlap"
              multiple
              onChange={onFile}
              className="sr-only"
            />
          </label>
        </div>
        {isDlap && dlapHints ? (
          <p
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-sm text-amber-100"
          >
            {dlapHints.message}
            {dlapHints.trackNameHint ? (
              <span className="mt-1 block text-amber-200/80">
                Hint from map PNG: {dlapHints.trackNameHint}
                {dlapHints.sessionDateHint
                  ? ` · ${dlapHints.sessionDateHint}`
                  : ""}
              </span>
            ) : null}
          </p>
        ) : null}
        {primaryKind === "csv" ? (
          <label className="flex items-start gap-3 rounded-xl border border-zinc-800/80 px-3 py-3 text-sm text-zinc-400">
            <input
              type="checkbox"
              checked={csvAsGoProExport}
              onChange={(event) => setCsvAsGoProExport(event.target.checked)}
              className="mt-1"
            />
            <span>
              Force Quik / Telemetry Overlay CSV (auto-detect laps from track
              start/finish). Leave unchecked to auto-detect Dragy vs TrackAddict
              / RaceRender.
            </span>
          </label>
        ) : null}
        {isMp4 ? (
          <p className="rounded-xl border border-zinc-800/80 px-3 py-3 text-sm text-zinc-400">
            GoPro <code className="text-zinc-300">.mp4</code> /{" "}
            <code className="text-zinc-300">.lrv</code> /{" "}
            <code className="text-zinc-300">.mov</code> is read{" "}
            <strong className="font-medium text-zinc-200">in-browser for GPS
            only</strong>{" "}
            (never uploaded). Upload the video to YouTube and paste the link
            below for onboard sync. Multi-chapter: select several files together.
          </p>
        ) : null}
        {isDedicatedGps || isMp4 ? (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-zinc-400">
              YouTube URL for onboard sync{isMp4 ? "" : " (optional)"}
            </span>
            <input
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://youtu.be/… or paste video id"
              className="min-h-12 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2 sm:min-h-10 sm:py-2 sm:text-sm"
            />
            <span className="text-xs text-zinc-500">
              Videos are YouTube-only. Upload the onboard to YouTube and paste
              the link — then sync offset on the lap page.
            </span>
          </label>
        ) : null}
        {previewQuality || isDedicatedGps ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
            <span>GPS source:</span>
            <GpsQualityBadge
              quality={previewQuality}
              sourceKind={
                isMp4 ? "gopro" : isLoggerExport ? "logger" : "csv"
              }
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
      </div>
    </form>
  );
}
