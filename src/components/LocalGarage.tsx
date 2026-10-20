"use client";

import {
  CornerBreakdownTable,
  TheoreticalBestCard,
} from "@/components/AnalysisPanels";
import { AttributionCard } from "@/components/Attribution";
import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { SaveComparisonControls } from "@/components/SaveComparisonControls";
import type { ComparisonDraftSnapshot } from "@/lib/comparisons";
import { LapChips, LapList, type LapExcludeChange } from "@/components/LapList";
import { UnsplitLapsBanner } from "@/components/ReparseLapsCallout";
import { SessionLapDetail } from "@/components/SessionLapDetail";
import type { SessionToolTab } from "@/components/SessionToolsPanel";
import { SessionVideosCard } from "@/components/SessionVideosCard";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { UnsavedChangesBar } from "@/components/UnsavedChangesBar";
import { GpsModeToggle } from "@/components/GpsModeToggle";
import { useSessionLapSelection } from "@/components/useSessionLapSelection";
import { cornerBreakdown, theoreticalBestLap } from "@/lib/analysis";
import { useAnalysisMode } from "@/lib/analysis-mode";
import { getLocalBlob } from "@/lib/blob-store";
import { loadCatalogSession } from "@/lib/catalog";
import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import { GpsQualityBadge } from "@/components/GpsQualityBadge";
import { compareHref } from "@/lib/compare";
import { preferGpsSession } from "@/lib/gps-quality";
import { formatLapTime } from "@/lib/format";
import { bestLapTimeMs, lapsEligibleForBest } from "@/lib/lap-quality";
import { analysisPoints, mapMatchLap } from "@/lib/map-match";
import {
  getLocalSession,
  listSessionsForCompare,
  replaceLocalSessionLaps,
  setLocalLapExcluded,
  setLocalLapTrim,
  updateLocalSession,
  type StoredSession,
} from "@/lib/local-store";
import {
  applyLapTrim,
  mergeAdjacentLaps,
  splitLapAtProgress,
} from "@/lib/lap-trim";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { pickSessionVideoForLap } from "@/lib/pick-session-video";
import { looksLikeUnsplitLaps } from "@/lib/session-reparse";
import type { SessionVideo } from "@/lib/types";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function CompareLink({
  sessionId,
  laps,
  focusId,
  label = "Compare laps",
}: {
  sessionId: string;
  laps: { id: string; lap_time_ms: number; excluded?: boolean | null }[];
  focusId?: string;
  label?: string;
}) {
  const href = compareHref(sessionId, laps, focusId);
  if (!href) return null;
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
    >
      {label}
    </Link>
  );
}

function LoadingShell({ label }: { label: string }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-zinc-500">{label}</p>
      </main>
    </>
  );
}

function MissingShell({ message }: { message: string }) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-sm text-zinc-400">{message}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-orange-400">
          Back to tracks
        </Link>
      </main>
    </>
  );
}

function SessionNotes({ session }: { session: StoredSession }) {
  const bits = [
    session.driver ? `Driver ${session.driver}` : null,
    session.carClass ? session.carClass : null,
    session.carTags?.length ? session.carTags.join(", ") : null,
    session.weather ? `Weather: ${session.weather}` : null,
    session.tires ? `Tires: ${session.tires}` : null,
    session.notes ? session.notes : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return (
    <p className="text-sm leading-relaxed text-zinc-500">{bits.join(" · ")}</p>
  );
}

export function LocalCompare({
  id,
  initialRef,
  initialOther,
  initialOtherSession,
  initialLaps,
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
  initialOtherSession?: string;
  initialLaps?: string;
}) {
  const session = useLocalSession(id);
  const [peerSessions, setPeerSessions] = useState<StoredSession[]>([]);
  const [draft, setDraft] = useState<ComparisonDraftSnapshot | null>(null);
  const onDraftChange = useCallback((next: ComparisonDraftSnapshot) => {
    setDraft(next);
  }, []);

  useEffect(() => {
    if (!session) return;
    const locals = listSessionsForCompare({
      trackId: session.trackId,
    });
    // Prefer uploads first, keep current session included.
    const ordered = [
      ...locals.filter((item) => item.id === session.id),
      ...locals.filter((item) => item.kind === "upload" && item.id !== session.id),
      ...locals.filter(
        (item) => item.kind !== "upload" && item.id !== session.id,
      ),
    ];
    // Always include current even if filters excluded it somehow.
    if (!ordered.some((item) => item.id === session.id)) {
      ordered.unshift(session);
    }
    setPeerSessions(ordered);
  }, [session]);

  const compareCenterline = useMemo(() => {
    if (!session) return null;
    return resolveTrackCenterline(
      session.trackId,
      null,
      session.laps.map((item) => item.telemetry),
    );
  }, [session]);
  const { mode: analysisMode } = useAnalysisMode(Boolean(compareCenterline));

  if (session === undefined) return <LoadingShell label="Loading comparison…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
  }

  const toRows = (item: StoredSession) =>
    item.laps.map((lap) => ({
      id: lap.id,
      session_id: item.id,
      user_id: "local",
      lap_number: lap.lap_number,
      lap_time_ms: lap.lap_time_ms,
      telemetry: lap.telemetry,
      excluded: lap.excluded ?? false,
      exclude_reason: lap.exclude_reason ?? null,
    }));

  const compareSessions = peerSessions
    .map((item) => ({
      id: item.id,
      name: item.name,
      car: item.car,
      kind: item.kind,
      trackId: item.trackId,
      sourceKind: item.sourceKind ?? null,
      gpsQuality: item.gpsQuality ?? null,
      videos: (item.videos ?? []).filter(
        (v) => v.provider === "youtube" && v.youtubeId,
      ),
      laps: toRows(item),
    }))
    .sort((a, b) => preferGpsSession(a, b));

  const laps = toRows(session);
  const shareParams = new URLSearchParams();
  if (initialRef) shareParams.set("ref", initialRef);
  if (initialOther) shareParams.set("other", initialOther);
  if (initialOtherSession) shareParams.set("otherSession", initialOtherSession);
  if (initialLaps) shareParams.set("laps", initialLaps);
  const href = shareParams.size
    ? `/sessions/${session.id}/compare?${shareParams.toString()}`
    : compareHref(session.id, laps);
  const refId = initialRef || laps[0]?.id;
  const otherSession =
    compareSessions.find((item) => item.id === initialOtherSession) ??
    compareSessions.find((item) => item.laps.some((lap) => lap.id === initialOther)) ??
    compareSessions.find((item) => item.id !== session.id) ??
    compareSessions[0];
  const otherId =
    initialOther ||
    otherSession?.laps.find((lap) => lap.id !== refId)?.id ||
    otherSession?.laps[0]?.id;
  const refLap = session.laps.find((lap) => lap.id === refId);
  const otherLap =
    otherSession?.laps.find((lap) => lap.id === otherId) ??
    session.laps.find((lap) => lap.id === otherId);
  const corners =
    refLap && otherLap && refLap.id !== otherLap.id
      ? cornerBreakdown(
          {
            lapNumber: refLap.lap_number,
            lapTimeMs: refLap.lap_time_ms,
            points: analysisPoints(
              mapMatchLap(refLap.telemetry, compareCenterline),
              refLap.telemetry,
              analysisMode,
            ),
          },
          {
            lapNumber: otherLap.lap_number,
            lapTimeMs: otherLap.lap_time_ms,
            points: analysisPoints(
              mapMatchLap(otherLap.telemetry, compareCenterline),
              otherLap.telemetry,
              analysisMode,
            ),
          },
        )
      : [];

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-3 py-1.5 pb-8 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
          <div className="min-w-0">
            <Link
              href={`/sessions/${session.id}`}
              className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
            >
              {session.name}
            </Link>
            <h1 className="truncate text-base font-semibold tracking-tight text-zinc-50 sm:text-lg">
              Compare laps
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {href ? (
              <ShareLinkButton path={href} label="Copy compare link" />
            ) : null}
            <SaveComparisonControls draft={draft} />
          </div>
        </div>
        <LapCompare
          laps={laps}
          sessions={compareSessions}
          initialRef={initialRef}
          initialOther={initialOther}
          initialOtherSession={initialOtherSession}
          initialLaps={initialLaps}
          initialTrackId={session.trackId}
          onDraftChange={onDraftChange}
          extraToolTabs={[
            {
              id: "notes",
              label: "Notes",
              content: (
                <div className="space-y-3">
                  <SessionNotes session={session} />
                  <AttributionCard
                    kind={session.kind ?? "upload"}
                    attribution={session.attribution}
                    compact
                  />
                  {corners.length ? (
                    <CornerBreakdownTable
                      corners={corners}
                      referenceLabel={`Lap ${refLap?.lap_number}`}
                      otherLabel={`Lap ${otherLap?.lap_number}`}
                    />
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </main>
    </div>
  );
}

function useLocalSession(id: string) {
  const [session, setSession] = useState<StoredSession | null | undefined>(
    undefined,
  );

  useEffect(() => {
    let cancelled = false;
    const local = getLocalSession(id);
    if (local) {
      const frame = window.requestAnimationFrame(() => {
        if (!cancelled) setSession(local);
      });
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(frame);
      };
    }
    loadCatalogSession(id)
      .then((loaded) => {
        if (!cancelled) setSession(loaded);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return session;
}

export function LocalSession({ id }: { id: string }) {
  const session = useLocalSession(id);
  const [reprocessMsg, setReprocessMsg] = useState<string | null>(null);
  const [reprocessBusy, setReprocessBusy] = useState(false);
  const [reparseOpen, setReparseOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftLaps, setDraftLaps] = useState<StoredSession["laps"] | null>(
    null,
  );
  const [draftVideos, setDraftVideos] = useState<SessionVideo[] | null>(null);
  const [toolsOpenRequest, setToolsOpenRequest] = useState<{
    tab: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    setDraftLaps(null);
    setDraftVideos(null);
    setDirty(false);
  }, [id, session?.id]);

  const centerline = useMemo(() => {
    if (!session) return null;
    return resolveTrackCenterline(
      session.trackId,
      null,
      session.laps.map((lap) => lap.telemetry),
    );
  }, [session]);
  const {
    mode: analysisMode,
    setMode: setAnalysisMode,
    hasSnap: hasAnalysisSnap,
  } = useAnalysisMode(Boolean(centerline));

  const theo = useMemo(() => {
    if (!session) return null;
    const eligible = lapsEligibleForBest(session.laps);
    if (!eligible.length) return null;
    return theoreticalBestLap(
      eligible.map((lap) => ({
        lapNumber: lap.lap_number,
        lapTimeMs: lap.lap_time_ms,
        points: analysisPoints(
          mapMatchLap(lap.telemetry, centerline),
          lap.telemetry,
          analysisMode,
        ),
      })),
    );
  }, [session, centerline, analysisMode]);

  const pickLaps = useMemo(
    () =>
      (session?.laps ?? []).map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        excluded: lap.excluded ?? false,
      })),
    [session],
  );
  const { selected, selectLap, videoParam } = useSessionLapSelection(pickLaps);

  if (session === undefined) return <LoadingShell label="Loading session…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
  }

  const sessionLaps = session.laps;
  const workingLaps = draftLaps ?? sessionLaps;
  const workingVideos = draftVideos ?? session.videos ?? [];
  const best = bestLapTimeMs(workingLaps);
  const sessionId = session.id;
  const laps = workingLaps.map((lap) => ({
    id: lap.id,
    session_id: sessionId,
    user_id: "local",
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    telemetry: lap.telemetry,
    excluded: lap.excluded ?? false,
    exclude_reason: lap.exclude_reason ?? null,
    start_offset_sec: lap.start_offset_sec,
    start_offset_override: lap.start_offset_override ?? null,
    end_offset_override: lap.end_offset_override ?? null,
  }));

  function onExcludeChange(change: LapExcludeChange) {
    setDraftLaps((prev) => {
      const base = prev ?? sessionLaps;
      return base.map((lap) =>
        lap.id === change.lapId
          ? {
              ...lap,
              excluded: change.excluded,
              exclude_reason: change.excluded
                ? (change.exclude_reason ?? "manual")
                : null,
            }
          : lap,
      );
    });
    setDirty(true);
  }

  function onTrimChange(change: {
    lapId: string;
    start_offset_override: number | null;
    end_offset_override: number | null;
  }) {
    setDraftLaps((prev) => {
      const base = prev ?? sessionLaps;
      return base.map((lap) => {
        if (lap.id !== change.lapId) return lap;
        const next = {
          ...lap,
          start_offset_override: change.start_offset_override,
          end_offset_override: change.end_offset_override,
        };
        const applied = applyLapTrim(next);
        return { ...next, lap_time_ms: applied.lap_time_ms };
      });
    });
    setDirty(true);
  }

  function onTrimReset(lapId: string) {
    onTrimChange({
      lapId,
      start_offset_override: null,
      end_offset_override: null,
    });
  }

  function discardEdits() {
    setDraftLaps(null);
    setDraftVideos(null);
    setDirty(false);
  }

  function saveEdits() {
    setSaving(true);
    try {
      if (draftLaps) {
        for (const lap of draftLaps) {
          const baseline = sessionLaps.find((row) => row.id === lap.id);
          if (!baseline) continue;
          if (
            (lap.start_offset_override ?? null) !==
              (baseline.start_offset_override ?? null) ||
            (lap.end_offset_override ?? null) !==
              (baseline.end_offset_override ?? null)
          ) {
            setLocalLapTrim(sessionId, lap.id, {
              start_offset_override: lap.start_offset_override ?? null,
              end_offset_override: lap.end_offset_override ?? null,
            });
          }
          if (
            Boolean(lap.excluded) !== Boolean(baseline.excluded) ||
            (lap.exclude_reason ?? null) !== (baseline.exclude_reason ?? null)
          ) {
            setLocalLapExcluded(
              sessionId,
              lap.id,
              Boolean(lap.excluded),
              lap.exclude_reason,
            );
          }
        }
      }
      if (draftVideos) {
        updateLocalSession(sessionId, {
          videos: draftVideos.filter((v) => v.provider === "youtube"),
        });
      }
      setDraftLaps(null);
      setDraftVideos(null);
      setDirty(false);
      window.location.reload();
    } finally {
      setSaving(false);
    }
  }

  function onMergeNext(lapId: string) {
    if (!session) return;
    const merged = mergeAdjacentLaps(
      session.laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        start_offset_sec: lap.start_offset_sec,
        telemetry: lap.telemetry,
        start_offset_override: lap.start_offset_override,
        end_offset_override: lap.end_offset_override,
      })),
      lapId,
    );
    if (!merged) return;
    updateLocalSession(sessionId, {
      laps: merged.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        telemetry: lap.telemetry,
        start_offset_sec: lap.start_offset_sec ?? undefined,
        start_offset_override: lap.start_offset_override,
        end_offset_override: lap.end_offset_override,
      })),
    });
    window.location.reload();
  }

  function onSplit(lapId: string, progress: number) {
    if (!session) return;
    const split = splitLapAtProgress(
      session.laps.map((lap) => ({
        id: lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        start_offset_sec: lap.start_offset_sec,
        telemetry: lap.telemetry,
        start_offset_override: lap.start_offset_override,
        end_offset_override: lap.end_offset_override,
      })),
      lapId,
      progress,
    );
    if (!split) return;
    updateLocalSession(sessionId, {
      laps: split.map((lap) => ({
        id: lap.id.startsWith(lapId) && lap.id !== lapId
          ? crypto.randomUUID()
          : lap.id,
        lap_number: lap.lap_number,
        lap_time_ms: lap.lap_time_ms,
        telemetry: lap.telemetry,
        start_offset_sec: lap.start_offset_sec ?? undefined,
        start_offset_override: null,
        end_offset_override: null,
      })),
    });
    window.location.reload();
  }

  const selectedLap =
    workingLaps.find((lap) => lap.id === selected?.id) ?? null;
  const track = session.trackId ? getTrack(session.trackId) : null;
  const current = session;
  const openTool = (tab: string) =>
    setToolsOpenRequest((prev) => ({
      tab,
      nonce: (prev?.nonce ?? 0) + 1,
    }));

  async function reprocess() {
    setReprocessBusy(true);
    setReprocessMsg(null);
    try {
      if (current.sourceKind === "gopro") {
        throw new Error("Re-upload the GoPro MP4 to re-extract GPMF in the browser.");
      }
      if (current.rawObjectKey?.startsWith("local/")) {
        const blob = await getLocalBlob(current.rawObjectKey);
        if (!blob) throw new Error("Original CSV is missing from this browser.");
        const lapsParsed = parseTelemetryCsv(await blob.text());
        const updated = replaceLocalSessionLaps(current.id, lapsParsed.laps, {
          startedAtMs: lapsParsed.startedAtMs,
          sessionDate: lapsParsed.sessionDate,
        });
        if (!updated) throw new Error("Could not update session");
        setReprocessMsg(`Re-processed ${lapsParsed.laps.length} laps from the stored CSV.`);
        window.location.reload();
        return;
      }
      if (current.rawObjectKey) {
        const response = await fetch(
          `/api/storage/download?key=${encodeURIComponent(current.rawObjectKey)}`,
        );
        if (!response.ok) throw new Error("Could not download stored CSV");
        const lapsParsed = parseTelemetryCsv(await response.text());
        replaceLocalSessionLaps(current.id, lapsParsed.laps, {
          startedAtMs: lapsParsed.startedAtMs,
          sessionDate: lapsParsed.sessionDate,
        });
        setReprocessMsg(`Re-processed ${lapsParsed.laps.length} laps.`);
        window.location.reload();
        return;
      }
      throw new Error("No stored original for this session.");
    } catch (error) {
      setReprocessMsg(error instanceof Error ? error.message : "Re-process failed");
    } finally {
      setReprocessBusy(false);
    }
  }

  const youtubeVideos = workingVideos.filter(
    (item) => item.provider === "youtube" && item.youtubeId,
  );

  const dedicatedVideoLapIds = workingVideos
    .filter((v) => v.provider === "youtube" && v.youtubeId && v.lapId)
    .map((v) => v.lapId as string);
  const hasSessionVideo = workingVideos.some(
    (v) =>
      v.provider === "youtube" &&
      v.youtubeId &&
      (v.lapId == null || v.lapId === ""),
  );

  const localToolTabs: SessionToolTab[] = [
    {
      id: "notes",
      label: "Notes",
      content: (
        <div className="space-y-3">
          <SessionNotes session={session} />
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              GPS quality
            </p>
            <GpsQualityBadge
              quality={session.gpsQuality}
              sourceKind={session.sourceKind}
            />
          </div>
          {theo ? (
            <div className="space-y-2">
              {hasAnalysisSnap ? (
                <GpsModeToggle
                  mode={analysisMode}
                  onChange={setAnalysisMode}
                  label="Delta"
                  ariaLabel="Delta calculation mode"
                />
              ) : null}
              <TheoreticalBestCard result={theo} />
            </div>
          ) : null}
          {session.kind === "upload" ? (
            <div className="space-y-2">
              <button
                type="button"
                disabled={reprocessBusy}
                onClick={reprocess}
                className="min-h-9 rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.14em] text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
              >
                {reprocessBusy ? "Re-processing…" : "Re-process from original"}
              </button>
              {reprocessMsg ? (
                <p className="text-xs text-zinc-500">{reprocessMsg}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "videos",
      label: "Videos",
      content: (
        <SessionVideosCard
          session={{
            id: session.id,
            trackId: session.trackId,
            sessionDate: session.sessionDate,
            startedAtMs: session.startedAtMs,
            created_at: session.created_at,
            laps: session.laps.map((lap) => ({
              id: lap.id,
              lap_number: lap.lap_number,
              lap_time_ms: lap.lap_time_ms,
            })),
          }}
          videos={workingVideos}
          onChange={(videos) => {
            setDraftVideos(videos);
            setDirty(true);
          }}
        />
      ),
    },
  ];

  const unsplit = looksLikeUnsplitLaps(laps);
  const openReparse = () => {
    setReparseOpen(true);
    if (session.kind === "upload" && !reprocessBusy) {
      void reprocess();
    }
  };

  const lapSidebar = (
    <div id="session-lap-list">
      {laps.length ? (
        <LapList
          laps={laps}
          selectedId={selected?.id}
          onSelect={(lap) => selectLap(lap)}
          videoLapIds={dedicatedVideoLapIds}
          sessionVideo={hasSessionVideo}
          canEdit
          onExcludeChange={onExcludeChange}
          onReparseLaps={openReparse}
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
      <AppHeader />
      <UnsavedChangesBar
        dirty={dirty}
        saving={saving}
        loading={false}
        onSave={saveEdits}
        onDiscard={discardEdits}
      />
      <main className="mx-auto w-full max-w-[90rem] flex-1 px-3 py-1.5 pb-8 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <Link
                href={track ? `/tracks/${track.id}` : "/"}
                className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-300"
              >
                {track ? track.name : "All tracks"}
              </Link>
              <h1 className="truncate text-base font-semibold tracking-tight text-zinc-50 sm:text-lg">
                {session.name}
              </h1>
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {session.car ? `${session.car} · ` : ""}
              {workingLaps.length} laps
              {best != null ? ` · best ${formatLapTime(best)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ShareLinkButton path={`/sessions/${session.id}`} label="Share" />
            <CompareLink
              sessionId={session.id}
              laps={laps}
              focusId={selectedLap?.id}
              label={
                laps.length < 2
                  ? "Compare with other sessions"
                  : "Compare laps"
              }
            />
          </div>
        </div>

        <div className="mb-2 space-y-2">
          <div
            className="flex flex-wrap gap-1.5"
            role="toolbar"
            aria-label="Session tools"
          >
            <button
              type="button"
              data-testid="toolbar-reparse"
              onClick={openReparse}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-orange-500/50 bg-orange-500/10 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-orange-200"
            >
              <span aria-hidden>↻</span> Re-parse laps
            </button>
            <button
              type="button"
              data-testid="toolbar-trim"
              onClick={() => openTool("trim")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-200"
            >
              <span aria-hidden>✂</span> Trim
            </button>
            <button
              type="button"
              data-testid="toolbar-sync"
              onClick={() => openTool("sync")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-200"
            >
              <span aria-hidden>⏯</span> Sync video
            </button>
            <button
              type="button"
              data-testid="toolbar-exclude"
              onClick={() => openTool("exclude")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-200"
            >
              <span aria-hidden>⊘</span> Exclude
            </button>
            <button
              type="button"
              data-testid="toolbar-details"
              onClick={() => openTool("notes")}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-200"
            >
              <span aria-hidden>✎</span> Edit details
            </button>
          </div>
          {reparseOpen ? (
            <div
              className="rounded-xl border border-zinc-800/80 bg-zinc-950/80 p-3"
              data-testid="reparse-flow"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                  Re-parse laps
                </p>
                <button
                  type="button"
                  onClick={() => setReparseOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  Close
                </button>
              </div>
              <p className="text-sm text-zinc-400">
                Re-split this local session from the original file kept in the
                browser.
              </p>
              <button
                type="button"
                disabled={reprocessBusy || session.kind !== "upload"}
                onClick={() => void reprocess()}
                className="mt-2 min-h-10 w-full rounded-lg bg-orange-500 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-black hover:bg-orange-400 disabled:opacity-40"
              >
                {reprocessBusy ? "Re-parsing…" : "Re-parse laps"}
              </button>
              {reprocessMsg ? (
                <p className="mt-2 text-xs text-zinc-500">{reprocessMsg}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {unsplit && !reparseOpen ? (
          <div className="pb-2 lg:hidden">
            <UnsplitLapsBanner onClick={openReparse} />
          </div>
        ) : null}

        {laps.length ? (
          <div className="pb-2 lg:hidden">
            <LapChips
              laps={laps}
              selectedId={selected?.id}
              onSelect={(lap) => selectLap(lap)}
              videoLapIds={dedicatedVideoLapIds}
              sessionVideo={hasSessionVideo}
            />
          </div>
        ) : null}

        {selectedLap ? (
          <SessionLapDetail
            sessionId={session.id}
            layout="workspace"
            sidebar={lapSidebar}
            extraToolTabs={localToolTabs}
            toolsOpenRequest={toolsOpenRequest}
            toolsShowButtons={false}
            lap={{
              id: selectedLap.id,
              lap_number: selectedLap.lap_number,
              lap_time_ms: selectedLap.lap_time_ms,
              start_offset_sec: selectedLap.start_offset_sec,
              telemetry: selectedLap.telemetry,
              excluded: selectedLap.excluded ?? false,
              exclude_reason: selectedLap.exclude_reason ?? null,
              start_offset_override:
                selectedLap.start_offset_override ?? null,
              end_offset_override: selectedLap.end_offset_override ?? null,
            }}
            siblingLaps={workingLaps.map((item) => ({
              id: item.id,
              lap_number: item.lap_number,
              lap_time_ms: item.lap_time_ms,
              start_offset_sec: item.start_offset_sec,
              telemetry: item.telemetry,
              excluded: item.excluded ?? false,
              exclude_reason: item.exclude_reason ?? null,
              start_offset_override: item.start_offset_override ?? null,
              end_offset_override: item.end_offset_override ?? null,
            }))}
            videos={youtubeVideos}
            videoParam={videoParam}
            trackId={session.trackId}
            sessionStartedAtMs={session.startedAtMs}
            canEdit
            onExcludeChange={onExcludeChange}
            onTrimChange={onTrimChange}
            onTrimReset={onTrimReset}
            onMergeNext={onMergeNext}
            onSplit={onSplit}
            onVideoChange={
              session.kind === "upload"
                ? (next) => {
                    const base = draftVideos ?? session.videos ?? [];
                    const nextVideos = base.map((item) =>
                      item.id === next.id ? next : item,
                    );
                    if (!nextVideos.some((item) => item.id === next.id)) {
                      nextVideos.push(next);
                    }
                    setDraftVideos(
                      nextVideos.filter((v) => v.provider === "youtube"),
                    );
                    setDirty(true);
                  }
                : undefined
            }
          />
        ) : (
          lapSidebar
        )}
      </main>
    </div>
  );
}

