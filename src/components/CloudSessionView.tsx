"use client";

import { AppHeader } from "@/components/AppHeader";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { LapChips, LapList, type LapExcludeChange } from "@/components/LapList";
import { SessionPageSkeleton } from "@/components/PageSkeleton";
import { UnsplitLapsBanner } from "@/components/ReparseLapsCallout";
import { SessionDetailsEditor } from "@/components/SessionDetailsEditor";
import {
  SessionReparsePanel,
  type ReparseStagePayload,
} from "@/components/SessionReparsePanel";
import { DeleteSessionControl } from "@/components/DeleteSessionControl";
import { SectionSaveHint } from "@/components/SectionSaveHint";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import {
  StartFinishEditor,
  nudgeSfEndpoint,
} from "@/components/StartFinishEditor";
import { UnsavedChangesBar } from "@/components/UnsavedChangesBar";
import { videoCoverage } from "@/lib/pick-session-video";
import { SessionVisibilityControl } from "@/components/SessionVisibilityControl";
import { useSessionLapSelection } from "@/components/useSessionLapSelection";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import type { GpsQuality } from "@/lib/gps-quality";
import { applyLapTrim } from "@/lib/lap-trim";
import { bestLapTimeMs } from "@/lib/lap-quality";
import { isSessionOwner } from "@/lib/session-owner";
import {
  buildReparseSaveBody,
  REPARSE_BODY_MAX_BYTES,
  reparseBodyTooLargeMessage,
} from "@/lib/reparse-save-body";
import {
  alignLoadedLapsToSf,
  hydrateLapsFromSourceGps,
} from "@/lib/hydrate-lap-telemetry";
import {
  parseStartFinishLine,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import { resolveTrackStartFinishLine } from "@/lib/track-start-finish";
import {
  autoBoundsForParsedLap,
  autoBoundsForStoredLap,
  lapAutoBoundsChanged,
  looksLikeUnsplitLaps,
  overridesOutsideAutoBounds,
  sessionDerivedFromLaps,
} from "@/lib/session-reparse";
import {
  deleteSessionVideo,
  fetchSessionVideos,
  upsertSessionVideo,
} from "@/lib/session-videos-cloud";
import { createClient, hasSupabaseConfig } from "@/lib/supabase/client";
import type { LapRow, SessionVideo, TelemetryPoint } from "@/lib/types";
import {
  DEFAULT_VISIBILITY,
  normalizeVisibility,
  type SessionVisibility,
} from "@/lib/visibility";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SessionLapDetail = dynamic(
  () =>
    import("@/components/SessionLapDetail").then((mod) => ({
      default: mod.SessionLapDetail,
    })),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-zinc-500">Loading lap charts…</p>
    ),
  },
);

type CloudSession = {
  id: string;
  name: string;
  user_id: string;
  car?: string | null;
  driver_name?: string | null;
  track_id?: string | null;
  visibility?: string | null;
  source_kind?: string | null;
  gps_quality?: GpsQuality | null;
  source_gps?: unknown;
  notes?: string | null;
  weather?: string | null;
  tires?: string | null;
  started_at?: string | null;
  session_date?: string | null;
  created_at: string;
};

/**
 * Loads a cloud session with the browser Supabase client so auth cookies
 * that work for uploads also work for viewing (avoids LocalSession "not found").
 * Lap selection is in-place via ?lap=N — no separate lap page.
 */
export function CloudSessionView({ id }: { id: string }) {
  const [email, setEmail] = useState<string | undefined>();
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<CloudSession | null | undefined>(
    undefined,
  );
  const [laps, setLaps] = useState<LapRow[]>([]);
  const [videos, setVideos] = useState<SessionVideo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [excludeError, setExcludeError] = useState<string | null>(null);
  const [trimError, setTrimError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reparseOpen, setReparseOpen] = useState(false);
  const [reparseNonce, setReparseNonce] = useState(0);
  const [pendingReparse, setPendingReparse] =
    useState<ReparseStagePayload | null>(null);
  /** Bumps after re-parse/save so trim sliders remount from new bounds. */
  const [lapsEpoch, setLapsEpoch] = useState(0);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [trackStartFinish, setTrackStartFinish] = useState<unknown>(null);
  const [sfMapLine, setSfMapLine] = useState<StartFinishLine | null>(null);
  const [sfEditing, setSfEditing] = useState(false);
  const sfMoveRef = useRef<
    ((which: "a" | "b", lat: number, lon: number) => void) | null
  >(null);
  const savedLapsRef = useRef<LapRow[]>([]);
  const savedVideosRef = useRef<SessionVideo[]>([]);
  const savedSessionRef = useRef<CloudSession | null>(null);
  const markDirty = useCallback(() => {
    setDirty(true);
    setSaveError(null);
  }, []);
  const onSfLineChange = useCallback(
    (line: StartFinishLine | null, editing: boolean) => {
      setSfEditing(editing);
      if (editing && line) {
        setSfMapLine(line);
        return;
      }
      // Not editing — show persisted / catalog SF when available.
      const stored =
        parseStartFinishLine(trackStartFinish) ??
        resolveTrackStartFinishLine(session?.track_id, trackStartFinish);
      setSfMapLine(stored);
    },
    [trackStartFinish, session?.track_id],
  );
  const onSfEndpointMove = useCallback(
    (which: "a" | "b", lat: number, lon: number) => {
      sfMoveRef.current?.(which, lat, lon);
      setSfMapLine((prev) =>
        prev ? nudgeSfEndpoint(prev, which, lat, lon) : prev,
      );
    },
    [],
  );

  // Auth is independent of session load so owner UI appears even if getUser
  // resolves after the public row (or via onAuthStateChange on iOS Safari).
  useEffect(() => {
    if (!hasSupabaseConfig()) return;
    let cancelled = false;
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setEmail(data.user?.email ?? undefined);
      setUserId(data.user?.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setEmail(next?.user?.email ?? undefined);
      setUserId(next?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setDirty(false);
      setPendingReparse(null);
      if (!hasSupabaseConfig()) {
        if (!cancelled) {
          setSession(null);
          setError("Supabase is not configured in this environment.");
          setLoading(false);
        }
        return;
      }
      try {
        const supabase = createClient();
        // Refresh auth in parallel with the row so mine flips as soon as both exist.
        void supabase.auth.getUser().then(({ data }) => {
          if (cancelled) return;
          setEmail(data.user?.email ?? undefined);
          setUserId(data.user?.id ?? null);
        });

        const { data: row, error: sessionError } = await supabase
          .from("sessions")
          .select(
            "id, name, user_id, car, driver_name, track_id, visibility, source_kind, gps_quality, notes, weather, tires, started_at, session_date, created_at, source_gps",
          )
          .eq("id", id)
          .maybeSingle();
        if (cancelled) return;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          setLoading(false);
          return;
        }
        if (!row) {
          // Public rows load via anon RLS. Missing ⇒ not found or private/friends.
          setSession(null);
          setError("not-found");
          setLoading(false);
          return;
        }
        const cloud = row as CloudSession;
        setSession(cloud);
        savedSessionRef.current = cloud;

        // Track + laps + videos in parallel after the session row lands.
        const trackPromise = cloud.track_id
          ? supabase
              .from("tracks")
              .select("id, lat, lon, start_finish")
              .eq("id", cloud.track_id)
              .maybeSingle()
          : Promise.resolve({ data: null });
        const lapsPromise = supabase
          .from("laps")
          .select("*")
          .eq("session_id", id)
          .order("lap_number", { ascending: true });
        const videosPromise = fetchSessionVideos(supabase, id).catch(() => []);

        const [trackResult, lapsResult, cloudVideos] = await Promise.all([
          trackPromise,
          lapsPromise,
          videosPromise,
        ]);
        if (cancelled) return;

        let resolvedSf: StartFinishLine | null = null;
        let storedSf: unknown = null;
        if (cloud.track_id) {
          storedSf = trackResult.data?.start_finish ?? null;
          resolvedSf =
            parseStartFinishLine(storedSf) ??
            resolveTrackStartFinishLine(cloud.track_id, storedSf);
          setTrackStartFinish(storedSf);
          setSfMapLine(resolvedSf);
        } else {
          setTrackStartFinish(null);
          setSfMapLine(null);
        }

        const rawLaps = (lapsResult.data ?? []) as LapRow[];
        // Slim re-parse Save can leave 2-pt stubs; rebuild from source_gps.
        const hydrated =
          (hydrateLapsFromSourceGps(rawLaps, cloud.source_gps, {
            startFinish: resolvedSf,
          }) as LapRow[] | null) ?? rawLaps;
        // Snap SF-facing endpoints onto the gate so in/out starts aren't "weird".
        const nextLaps = alignLoadedLapsToSf(hydrated, resolvedSf);
        setLaps(nextLaps);
        savedLapsRef.current = nextLaps;

        // YouTube-only UI — keep YouTube rows (legacy mp4 rows ignored in card).
        const nextVideos = cloudVideos.filter(
          (v) => v.provider === "youtube" && v.youtubeId,
        );
        setVideos(nextVideos);
        savedVideosRef.current = nextVideos;
      } catch (err) {
        if (!cancelled) {
          setSession(null);
          setError(err instanceof Error ? err.message : "Could not load session");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const pickLaps = useMemo(
    () =>
      laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
      })),
    [laps],
  );
  const { selected, selectLap, videoParam } = useSessionLapSelection(pickLaps);

  const selectedRow = useMemo(
    () => (selected ? laps.find((lap) => lap.id === selected.id) ?? null : null),
    [laps, selected],
  );

  const detailLaps = useMemo(
    () =>
      laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        start_offset_sec: lap.start_offset_sec,
        telemetry: (lap.telemetry ?? []) as TelemetryPoint[],
        excluded: lap.excluded ?? false,
        exclude_reason: lap.exclude_reason ?? null,
        start_offset_override: lap.start_offset_override ?? null,
        end_offset_override: lap.end_offset_override ?? null,
      })),
    [laps],
  );

  async function reloadFromServer() {
    if (!session) return;
    const supabase = createClient();
    const { data: lapRows } = await supabase
      .from("laps")
      .select("*")
      .eq("session_id", session.id)
      .order("lap_number", { ascending: true });
    const rawLaps = (lapRows ?? []) as LapRow[];
    const sf =
      sfMapLine ??
      parseStartFinishLine(trackStartFinish) ??
      resolveTrackStartFinishLine(session.track_id, trackStartFinish);
    const hydrated =
      (hydrateLapsFromSourceGps(rawLaps, session.source_gps, {
        startFinish: sf,
      }) as LapRow[] | null) ?? rawLaps;
    const nextLaps = alignLoadedLapsToSf(hydrated, sf);
    setLaps(nextLaps);
    savedLapsRef.current = nextLaps;
    try {
      const cloudVideos = await fetchSessionVideos(supabase, session.id);
      const nextVideos = cloudVideos.filter(
        (v) => v.provider === "youtube" && v.youtubeId,
      );
      setVideos(nextVideos);
      savedVideosRef.current = nextVideos;
    } catch {
      // keep
    }
    const { data: row } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", session.id)
      .maybeSingle();
    if (row) {
      const cloud = row as CloudSession;
      setSession(cloud);
      savedSessionRef.current = cloud;
    }
  }

  function onTrimChange(change: {
    lapId: string;
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) return;
    setTrimError(null);
    setLaps((rows) =>
      rows.map((lap) => {
        if (lap.id !== change.lapId) return lap;
        const next = {
          ...lap,
          start_offset_override: change.start_offset_override,
          end_offset_override: change.end_offset_override,
        };
        const applied = applyLapTrim({
          id: next.id,
          lap_number: next.lap_number,
          lap_time_ms: next.lap_time_ms,
          start_offset_sec: next.start_offset_sec,
          telemetry: (next.telemetry ?? []) as TelemetryPoint[],
          start_offset_override: next.start_offset_override,
          end_offset_override: next.end_offset_override,
        });
        return { ...next, lap_time_ms: applied.lap_time_ms };
      }),
    );
    markDirty();
  }

  function onTrimReset(lapId: string) {
    onTrimChange({
      lapId,
      start_offset_override: null,
      end_offset_override: null,
    });
  }

  async function onMergeNext(lapId: string) {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) return;
    setTrimError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${lapId}/trim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ merge_next: true }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setTrimError(payload.error ?? "Merge failed");
        return;
      }
      await reloadFromServer();
      setDirty(false);
      setPendingReparse(null);
    } finally {
      setSaving(false);
    }
  }

  async function onSplit(lapId: string, progress: number) {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) return;
    setTrimError(null);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/sessions/${session.id}/laps/${lapId}/trim`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ split_progress: progress }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setTrimError(payload.error ?? "Split failed");
        return;
      }
      await reloadFromServer();
      setDirty(false);
      setPendingReparse(null);
    } finally {
      setSaving(false);
    }
  }

  function onVisibility(next: SessionVisibility) {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) {
      return;
    }
    setVisibilityError(null);
    setSession({ ...session, visibility: next });
    markDirty();
  }

  function onExcludeChange(change: LapExcludeChange) {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) {
      return;
    }
    setExcludeError(null);
    setLaps((rows) =>
      rows.map((lap) =>
        lap.id === change.lapId
          ? {
              ...lap,
              excluded: change.excluded,
              exclude_reason: change.excluded
                ? (change.exclude_reason ?? "manual")
                : null,
            }
          : lap,
      ),
    );
    markDirty();
  }

  function onStageReparse(payload: ReparseStagePayload) {
    if (!session || !userId) return;
    setPendingReparse(payload);
    const staged: LapRow[] = payload.laps.map((lap) => {
      const prev =
        laps.find((row) => row.lap_number === lap.lapNumber) ??
        savedLapsRef.current.find((row) => row.lap_number === lap.lapNumber);
      const nextBounds = autoBoundsForParsedLap({
        lapNumber: lap.lapNumber,
        lapTimeMs: lap.lapTimeMs,
        points: lap.points,
        startOffsetSec: lap.startOffsetSec,
        startedAtMs: lap.startedAtMs,
      });
      const prevBounds = prev
        ? autoBoundsForStoredLap(prev)
        : null;
      const boundsChanged = prevBounds
        ? lapAutoBoundsChanged(prevBounds, nextBounds)
        : true;
      const staleOverrides =
        Boolean(prev) &&
        (boundsChanged ||
          overridesOutsideAutoBounds(
            {
              start_offset_override: prev?.start_offset_override,
              end_offset_override: prev?.end_offset_override,
            },
            nextBounds,
          ));
      return {
        // Fresh id when bounds change so trim/chart state cannot stick to the
        // old single-lap window after an unsplit → multi-lap re-parse.
        id: prev && !boundsChanged ? prev.id : crypto.randomUUID(),
        session_id: session.id,
        user_id: session.user_id,
        lap_number: lap.lapNumber,
        lap_time_ms: lap.lapTimeMs,
        telemetry: lap.points,
        start_offset_sec: lap.startOffsetSec ?? null,
        started_at_ms: lap.startedAtMs ?? null,
        excluded: prev?.excluded ?? false,
        exclude_reason: prev?.exclude_reason ?? null,
        start_offset_override: staleOverrides
          ? null
          : (prev?.start_offset_override ?? null),
        end_offset_override: staleOverrides
          ? null
          : (prev?.end_offset_override ?? null),
      };
    });
    setLaps(staged);
    setLapsEpoch((n) => n + 1);
    markDirty();
    setReparseOpen(false);
  }

  function discardEdits() {
    setLaps(savedLapsRef.current.map((lap) => ({ ...lap })));
    setVideos(savedVideosRef.current.map((video) => ({ ...video })));
    if (savedSessionRef.current) {
      setSession({ ...savedSessionRef.current });
    }
    setPendingReparse(null);
    setDirty(false);
    setSaveError(null);
    setTrimError(null);
    setExcludeError(null);
    setVisibilityError(null);
  }

  async function saveEdits() {
    if (!session || !userId || !isSessionOwner(session.user_id, userId)) return;
    setSaving(true);
    setSaveError(null);
    try {
      const supabase = createClient();

      // Capture staged rows before reparse clears them — after reload, lap
      // ids change so trim/exclude patches must match by lap_number.
      const stagedBeforeSave = laps;
      let didReparse = false;
      if (pendingReparse) {
        const { body: reparseBody, bytes: reparseBytes } = buildReparseSaveBody({
          laps: pendingReparse.laps,
          sourceGps: pendingReparse.sourceGps,
          trackId: pendingReparse.trackId,
          startFinish: pendingReparse.startFinish,
          startedAtMs: pendingReparse.startedAtMs,
          sessionDate: pendingReparse.sessionDate,
          gpsQuality: pendingReparse.gpsQuality,
        });
        if (reparseBytes > REPARSE_BODY_MAX_BYTES) {
          throw new Error(reparseBodyTooLargeMessage(reparseBytes));
        }
        const response = await fetch(`/api/sessions/${session.id}/reparse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(reparseBody),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (!response.ok) {
          const statusHint =
            response.status === 413
              ? " (payload too large — GPS was not saved)"
              : response.status === 401
                ? " (signed out — sign in and Save again)"
                : response.status === 404
                  ? " (not the session owner)"
                  : ` (HTTP ${response.status})`;
          throw new Error(
            (payload.error ?? "Could not save re-parse") + statusHint,
          );
        }
        // Keep pendingReparse until reload succeeds so a failed reload can retry.
        await reloadFromServer();
        setPendingReparse(null);
        setLapsEpoch((n) => n + 1);
        didReparse = true;
      }

      const savedSession = savedSessionRef.current;
      if (
        savedSession &&
        (session.name !== savedSession.name ||
          (session.car ?? "") !== (savedSession.car ?? "") ||
          (session.driver_name ?? "") !== (savedSession.driver_name ?? "") ||
          (session.notes ?? "") !== (savedSession.notes ?? "") ||
          (session.weather ?? "") !== (savedSession.weather ?? "") ||
          (session.tires ?? "") !== (savedSession.tires ?? "") ||
          normalizeVisibility(session.visibility ?? DEFAULT_VISIBILITY) !==
            normalizeVisibility(
              savedSession.visibility ?? DEFAULT_VISIBILITY,
            ))
      ) {
        const visibility = normalizeVisibility(
          session.visibility ?? DEFAULT_VISIBILITY,
        );
        const { error: sessionError } = await supabase
          .from("sessions")
          .update({
            name: session.name,
            car: session.car?.trim() || null,
            driver_name: session.driver_name?.trim() || null,
            notes: session.notes?.trim() || null,
            weather: session.weather?.trim() || null,
            tires: session.tires?.trim() || null,
            visibility,
          })
          .eq("id", session.id)
          .eq("user_id", userId);
        if (sessionError) {
          throw new Error(sessionError.message);
        }
        await fetch(`/api/sessions/${session.id}/visibility`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ visibility }),
        });
      }

      for (const staged of stagedBeforeSave) {
        const baseline = didReparse
          ? savedLapsRef.current.find(
              (row) => row.lap_number === staged.lap_number,
            )
          : savedLapsRef.current.find((row) => row.id === staged.id);
        if (!baseline) continue;
        const trimChanged =
          (staged.start_offset_override ?? null) !==
            (baseline.start_offset_override ?? null) ||
          (staged.end_offset_override ?? null) !==
            (baseline.end_offset_override ?? null);
        if (trimChanged) {
          const response = await fetch(
            `/api/sessions/${session.id}/laps/${baseline.id}/trim`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                start_offset_override: staged.start_offset_override ?? null,
                end_offset_override: staged.end_offset_override ?? null,
              }),
            },
          );
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(payload.error ?? "Could not save lap trim");
          }
        }
        const excludeChanged =
          Boolean(staged.excluded) !== Boolean(baseline.excluded) ||
          (staged.exclude_reason ?? null) !== (baseline.exclude_reason ?? null);
        if (excludeChanged) {
          const response = await fetch(
            `/api/sessions/${session.id}/laps/${baseline.id}/exclude`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                excluded: Boolean(staged.excluded),
                exclude_reason: staged.exclude_reason ?? null,
              }),
            },
          );
          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(payload.error ?? "Could not save exclude");
          }
        }
      }

      const prevIds = new Set(savedVideosRef.current.map((v) => v.id));
      const nextIds = new Set(videos.map((v) => v.id));
      for (const video of videos) {
        if (video.provider !== "youtube") continue;
        await upsertSessionVideo(supabase, session.id, userId, video);
      }
      for (const videoId of prevIds) {
        if (!nextIds.has(videoId)) {
          await deleteSessionVideo(supabase, videoId);
        }
      }

      await reloadFromServer();
      setDirty(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (session === undefined) {
    return (
      <>
        <AppHeader email={email} />
        <SessionPageSkeleton />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader email={email} />
        <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
          <p className="text-sm text-zinc-400">
            {error && error !== "not-found"
              ? error
              : "Session not found, or it is private / friends-only."}
          </p>
          <p className="mt-2 text-sm text-zinc-500">
            Public sessions open without an account.{" "}
            {!userId ? (
              <>
                <Link
                  href={`/login?next=${encodeURIComponent(`/sessions/${id}`)}`}
                  className="text-orange-400"
                >
                  Sign in
                </Link>{" "}
                only if this is a Friends or private session you own.
              </>
            ) : (
              "Ask the owner to set visibility to Public link to share."
            )}
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
            Browse public sessions
          </Link>
        </main>
      </>
    );
  }

  const derived = sessionDerivedFromLaps(laps);
  const best = derived.sessionBestMs ?? bestLapTimeMs(laps);
  const coverage = videoCoverage(
    videos,
    laps.map((lap) => lap.id),
  );
  const dedicatedVideoLapIds = [...coverage.byLapId.keys()];
  const syncedLapIds = videos
    .filter(
      (v) =>
        v.syncSource === "manual" ||
        v.syncSource === "auto" ||
        v.syncSource === "time_of_day",
    )
    .flatMap((v) =>
      v.lapId
        ? [v.lapId]
        : v.syncSource === "manual" ||
            v.syncSource === "auto" ||
            v.syncSource === "time_of_day"
          ? ["__session__"]
          : [],
    );
  const href = compareHref(session.id, laps);
  const mine = isSessionOwner(session.user_id, userId);
  const visibility = normalizeVisibility(session.visibility ?? DEFAULT_VISIBILITY);
  const startedAtMs = session.started_at
    ? Date.parse(session.started_at)
    : undefined;

  const savedSession = savedSessionRef.current;
  const detailsDirty =
    Boolean(savedSession) &&
    (session.name !== savedSession!.name ||
      (session.car ?? "") !== (savedSession!.car ?? "") ||
      (session.driver_name ?? "") !== (savedSession!.driver_name ?? "") ||
      (session.notes ?? "") !== (savedSession!.notes ?? "") ||
      (session.weather ?? "") !== (savedSession!.weather ?? "") ||
      (session.tires ?? "") !== (savedSession!.tires ?? "") ||
      normalizeVisibility(session.visibility ?? DEFAULT_VISIBILITY) !==
        normalizeVisibility(savedSession!.visibility ?? DEFAULT_VISIBILITY));

  const excludeDirty = laps.some((lap) => {
    const baseline = savedLapsRef.current.find((row) => row.id === lap.id);
    if (!baseline) return Boolean(lap.excluded);
    return (
      Boolean(lap.excluded) !== Boolean(baseline.excluded) ||
      (lap.exclude_reason ?? null) !== (baseline.exclude_reason ?? null)
    );
  });

  const trimDirty = laps.some((lap) => {
    const baseline = savedLapsRef.current.find((row) => row.id === lap.id);
    if (!baseline) {
      return (
        lap.start_offset_override != null || lap.end_offset_override != null
      );
    }
    return (
      (lap.start_offset_override ?? null) !==
        (baseline.start_offset_override ?? null) ||
      (lap.end_offset_override ?? null) !==
        (baseline.end_offset_override ?? null)
    );
  });

  const videoDirty = (() => {
    const prev = savedVideosRef.current;
    if (prev.length !== videos.length) return true;
    const byId = new Map(prev.map((v) => [v.id, v]));
    for (const video of videos) {
      const baseline = byId.get(video.id);
      if (!baseline) return true;
      if (
        video.youtubeId !== baseline.youtubeId ||
        video.offsetSec !== baseline.offsetSec ||
        video.syncSource !== baseline.syncSource ||
        video.lapId !== baseline.lapId
      ) {
        return true;
      }
    }
    return false;
  })();

  const unsplit = mine && looksLikeUnsplitLaps(laps);
  const openReparse = () => {
    setReparseNonce((n) => n + 1);
    setReparseOpen(true);
  };

  const reparsePanelNode = reparseOpen ? (
    <div data-testid="reparse-flow">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
          Re-parse laps
        </p>
        <button
          type="button"
          onClick={() => setReparseOpen(false)}
          className="apex-btn apex-btn--ghost"
        >
          Close
        </button>
      </div>
      <SessionReparsePanel
        key={`reparse-${session.id}-${reparseNonce}`}
        sessionId={session.id}
        trackId={session.track_id}
        sourceGps={session.source_gps}
        storedStartFinish={trackStartFinish}
        laps={savedLapsRef.current.length ? savedLapsRef.current : laps}
        startedAtMs={Number.isFinite(startedAtMs) ? startedAtMs : undefined}
        autoStart
        onStage={onStageReparse}
        onDone={() => {
          setTrimError(null);
          setReparseOpen(false);
        }}
      />
      {pendingReparse ? (
        <div className="mt-2">
          <SectionSaveHint
            dirty
            saving={saving}
            label="Unsaved re-parse"
            onSave={() => void saveEdits()}
            onDiscard={discardEdits}
          />
        </div>
      ) : null}
    </div>
  ) : null;

  const mapHeader =
    mine && session.track_id ? (
      <StartFinishEditor
        trackId={session.track_id}
        storedStartFinish={trackStartFinish}
        canEdit={mine}
        busy={saving || reparseOpen}
        moveEndpointRef={sfMoveRef}
        onLineChange={onSfLineChange}
        onSaved={(line) => {
          setTrackStartFinish(line);
          setSfMapLine(line);
        }}
        onRequestResplit={() => {
          openReparse();
        }}
      />
    ) : null;

  const lapSidebar = (
    <div id="session-lap-list">
      {laps.length ? (
        <LapList
          laps={laps}
          selectedId={selected?.id}
          onSelect={(lap) => selectLap(lap)}
          videoLapIds={dedicatedVideoLapIds}
          syncedLapIds={syncedLapIds}
          sessionVideo={Boolean(coverage.sessionLevel)}
          canEdit={mine}
          onExcludeChange={mine ? onExcludeChange : undefined}
          onReparseLaps={mine ? openReparse : undefined}
          reparsePanel={reparsePanelNode}
          excludeDirty={mine && excludeDirty}
          onSaveExclude={mine ? () => void saveEdits() : undefined}
          onDiscardExclude={mine ? discardEdits : undefined}
          saving={saving}
        />
      ) : (
        <p className="px-3 py-6 text-center text-sm text-zinc-500">
          No laps in this session.
        </p>
      )}
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader email={email} />
      {mine ? (
        <UnsavedChangesBar
          dirty={dirty}
          saving={saving}
          loading={loading}
          error={saveError}
          onSave={() => void saveEdits()}
          onDiscard={discardEdits}
        />
      ) : null}
      <main
        className="mx-auto w-full max-w-[90rem] flex-1 px-3 py-1 pb-8 sm:px-4 sm:py-1.5"
        data-apex-session-main="1"
      >
        <div
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pb-1"
          data-apex-session-chrome="1"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 sm:gap-x-3">
              <Link
                href={mine ? "/account" : "/lap-comparisons?tab=sessions"}
                className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
              >
                {mine ? "My Sessions" : userId ? "Friends" : "Public feed"}
              </Link>
              <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-50 sm:text-lg">
                {session.name}
              </h1>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500 sm:text-xs">
              {session.car ? `${session.car} · ` : ""}
              {laps.length} laps
              {best != null ? ` · best ${formatLapTime(best)}` : ""}
              {session.driver_name ? ` · ${session.driver_name}` : ""}
              {!mine ? ` · ${visibility}` : ""}
              <span className="hidden sm:inline">
                {session.weather ? ` · ${session.weather}` : ""}
                {session.tires ? ` · ${session.tires}` : ""}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {href ? (
              <Link
                href={href}
                className="inline-flex min-h-9 items-center text-[11px] uppercase tracking-[0.16em] text-orange-400 hover:text-orange-300 sm:min-h-10"
              >
                Compare
              </Link>
            ) : null}
            <ShareLinkButton path={`/sessions/${session.id}`} label="Share" />
            {mine ? (
              <DeleteSessionControl
                variant="toolbar"
                authUserId={userId}
                targets={[
                  {
                    id: session.id,
                    name: session.name,
                    user_id: session.user_id,
                  },
                ]}
              />
            ) : null}
          </div>
        </div>

        {/*
          Mobile: collapse the details card into a single GPS badge row so the
          map + Play sit in the first 393×852 viewport. Desktop keeps the card.
        */}
        <div
          className="mb-1 sm:mb-2 sm:rounded-xl sm:border sm:border-zinc-800/80 sm:bg-zinc-950/50 sm:p-3"
          data-testid="session-details-block"
          data-apex-session-details="1"
        >
          <div className="hidden flex-wrap items-center justify-between gap-2 sm:flex">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Session details
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                {visibility}
                {session.weather ? ` · ${session.weather}` : ""}
                {session.tires ? ` · tires ${session.tires}` : ""}
                {session.notes ? ` · ${session.notes}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {mine && detailsDirty ? (
                <SectionSaveHint
                  dirty
                  saving={saving}
                  label="Unsaved details"
                  onSave={() => void saveEdits()}
                  onDiscard={discardEdits}
                />
              ) : null}
              {mine ? (
                <button
                  type="button"
                  data-testid="toolbar-details"
                  className="apex-disclosure"
                  aria-expanded={detailsOpen}
                  aria-controls="session-details-panel"
                  onClick={() => setDetailsOpen((open) => !open)}
                >
                  <span className="apex-disclosure__label">Edit details</span>
                  <span className="apex-disclosure__chevron" aria-hidden>
                    ▾
                  </span>
                </button>
              ) : null}
            </div>
          </div>
          {mine ? (
            <div className="mb-1 flex flex-wrap items-center gap-1.5 sm:hidden">
              {detailsDirty ? (
                <SectionSaveHint
                  dirty
                  saving={saving}
                  label="Unsaved details"
                  onSave={() => void saveEdits()}
                  onDiscard={discardEdits}
                />
              ) : null}
              <button
                type="button"
                data-testid="toolbar-details"
                className="apex-disclosure"
                aria-expanded={detailsOpen}
                aria-controls="session-details-panel"
                onClick={() => setDetailsOpen((open) => !open)}
              >
                <span className="apex-disclosure__label">Details</span>
                <span className="apex-disclosure__chevron" aria-hidden>
                  ▾
                </span>
              </button>
            </div>
          ) : null}
          {detailsOpen && mine ? (
            <div
              id="session-details-panel"
              role="region"
              aria-label="Session details"
              className="mt-2 space-y-3 rounded-xl border border-zinc-800/80 bg-zinc-950/50 p-3 sm:mt-3 sm:rounded-none sm:border-0 sm:border-t sm:border-zinc-800/80 sm:bg-transparent sm:p-0 sm:pt-3"
            >
              <SessionDetailsEditor
                value={{
                  name: session.name,
                  car: session.car,
                  driver_name: session.driver_name,
                  notes: session.notes,
                  weather: session.weather,
                  tires: session.tires,
                }}
                onChange={(next) => {
                  setSession({
                    ...session,
                    name: next.name,
                    car: next.car,
                    driver_name: next.driver_name,
                    notes: next.notes,
                    weather: next.weather,
                    tires: next.tires,
                  });
                  markDirty();
                }}
              />
              <SessionVisibilityControl
                value={visibility}
                onChange={onVisibility}
                disabled={saving}
                compact
              />
              {visibilityError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
                >
                  {visibilityError}
                </p>
              ) : null}
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                  GPS quality
                </p>
                <GpsQualityBadge
                  quality={session.gps_quality}
                  sourceKind={
                    session.source_kind === "gopro" ||
                    session.source_kind === "csv" ||
                    session.source_kind === "logger"
                      ? session.source_kind
                      : null
                  }
                />
              </div>
            </div>
          ) : (
            <div className="hidden sm:mt-2 sm:block">
              <GpsQualityBadge
                quality={session.gps_quality}
                sourceKind={
                  session.source_kind === "gopro" ||
                  session.source_kind === "csv" ||
                  session.source_kind === "logger"
                    ? session.source_kind
                    : null
                }
              />
            </div>
          )}
          {excludeError ? (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            >
              {excludeError}
            </p>
          ) : null}
          {trimError ? (
            <p
              role="alert"
              className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
            >
              {trimError}
            </p>
          ) : null}
        </div>

        {unsplit && !reparseOpen ? (
          <div className="pb-1 lg:hidden sm:pb-2">
            <UnsplitLapsBanner onClick={openReparse} />
          </div>
        ) : null}

        {laps.length ? (
          <div className="pb-1 lg:hidden sm:pb-2">
            <LapChips
              laps={laps}
              selectedId={selected?.id}
              onSelect={(lap) => selectLap(lap)}
              videoLapIds={dedicatedVideoLapIds}
              syncedLapIds={syncedLapIds}
              sessionVideo={Boolean(coverage.sessionLevel)}
            />
          </div>
        ) : null}

        {selectedRow ? (
          <SessionLapDetail
            key={`lap-detail-${lapsEpoch}-${selectedRow.id}-${selectedRow.start_offset_sec ?? 0}-${selectedRow.lap_time_ms}`}
            sessionId={session.id}
            layout="workspace"
            sidebar={lapSidebar}
            toolsShowButtons={false}
            mapHeader={mapHeader}
            trimDirty={mine && (trimDirty || Boolean(pendingReparse))}
            videoDirty={mine && videoDirty}
            onSave={mine ? () => void saveEdits() : undefined}
            onDiscard={mine ? discardEdits : undefined}
            saving={saving}
            lap={{
              id: selectedRow.id,
              lap_number: selectedRow.lap_number,
              lap_time_ms: selectedRow.lap_time_ms,
              start_offset_sec: selectedRow.start_offset_sec,
              telemetry: (selectedRow.telemetry ?? []) as TelemetryPoint[],
              excluded: selectedRow.excluded ?? false,
              exclude_reason: selectedRow.exclude_reason ?? null,
              start_offset_override:
                selectedRow.start_offset_override ?? null,
              end_offset_override: selectedRow.end_offset_override ?? null,
            }}
            siblingLaps={detailLaps}
            videos={videos}
            videoParam={videoParam}
            trackId={session.track_id}
            sessionStartedAtMs={
              Number.isFinite(startedAtMs) ? startedAtMs : undefined
            }
            sfLine={sfMapLine}
            sfEditing={sfEditing}
            onSfEndpointMove={sfEditing ? onSfEndpointMove : undefined}
            canEdit={mine}
            onExcludeChange={mine ? onExcludeChange : undefined}
            onTrimChange={mine ? onTrimChange : undefined}
            onTrimReset={mine ? onTrimReset : undefined}
            onMergeNext={mine ? onMergeNext : undefined}
            onSplit={mine ? onSplit : undefined}
            onVideoChange={
              mine
                ? (next) => {
                    setVideos((prev) => {
                      const exists = prev.some((v) => v.id === next.id);
                      return exists
                        ? prev.map((v) => (v.id === next.id ? next : v))
                        : [...prev, next];
                    });
                    markDirty();
                  }
                : undefined
            }
          />
        ) : laps.length ? (
          <p className="text-sm text-zinc-500">Select a lap to view.</p>
        ) : (
          lapSidebar
        )}
      </main>
    </div>
  );
}
