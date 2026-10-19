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
import { LapChips, LapList } from "@/components/LapList";
import { SessionLapDetail } from "@/components/SessionLapDetail";
import { SessionVideosCard } from "@/components/SessionVideosCard";
import { ShareLinkButton } from "@/components/ShareLinkButton";
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
import { analysisPoints, mapMatchLap } from "@/lib/map-match";
import {
  getLocalSession,
  listSessionsForCompare,
  replaceLocalSessionLaps,
  updateLocalSession,
  type StoredSession,
} from "@/lib/local-store";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { sessionLapHref } from "@/lib/session-lap-url";
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
  laps: { id: string; lap_time_ms: number }[];
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
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        <div className="space-y-3">
          <Link
            href={`/sessions/${session.id}`}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {session.name}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Compare laps
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Compare within this session or against other uploads and catalog
                sessions{session.trackId ? " — filter by track" : ""}.
              </p>
            </div>
            {href ? <ShareLinkButton path={href} label="Copy compare link" /> : null}
          </div>
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
          <SessionNotes session={session} />
        </div>
        <SaveComparisonControls draft={draft} />
        <LapCompare
          laps={laps}
          sessions={compareSessions}
          initialRef={initialRef}
          initialOther={initialOther}
          initialOtherSession={initialOtherSession}
          initialLaps={initialLaps}
          initialTrackId={session.trackId}
          onDraftChange={onDraftChange}
        />
        {corners.length ? (
          <CornerBreakdownTable
            corners={corners}
            referenceLabel={`Lap ${refLap?.lap_number}`}
            otherLabel={`Lap ${otherLap?.lap_number}`}
          />
        ) : null}
      </main>
    </>
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
    return theoreticalBestLap(
      session.laps.map((lap) => ({
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
      })),
    [session],
  );
  const { selected, selectLap, videoParam } = useSessionLapSelection(pickLaps);

  if (session === undefined) return <LoadingShell label="Loading session…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
  }

  const best = session.laps.reduce(
    (min, lap) => Math.min(min, lap.lap_time_ms),
    Number.POSITIVE_INFINITY,
  );
  const laps = session.laps.map((lap) => ({
    id: lap.id,
    session_id: session.id,
    user_id: "local",
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    telemetry: lap.telemetry,
    start_offset_sec: lap.start_offset_sec,
  }));

  const selectedLap =
    session.laps.find((lap) => lap.id === selected?.id) ?? null;
  const track = session.trackId ? getTrack(session.trackId) : null;
  const comparePath = compareHref(session.id, laps);
  const shareLapPath = selectedLap
    ? sessionLapHref(session.id, selectedLap, {
        videoId: videoParam ?? undefined,
      })
    : `/sessions/${session.id}`;
  const current = session;

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

  const youtubeVideos = (session.videos ?? []).filter(
    (item) => item.provider === "youtube" && item.youtubeId,
  );

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
        <div className="space-y-3">
          <Link
            href={track ? `/tracks/${track.id}` : "/"}
            className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300"
          >
            {track ? track.name : "All tracks"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
            {session.name}
          </h1>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
              <span>
                {session.car ? `${session.car} · ` : ""}
                {session.laps.length} laps
                {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
              </span>
              <GpsQualityBadge
                quality={session.gpsQuality}
                sourceKind={session.sourceKind}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ShareLinkButton path={shareLapPath} label="Copy lap link" />
              <ShareLinkButton path={`/sessions/${session.id}`} />
              {comparePath ? (
                <ShareLinkButton path={comparePath} label="Copy compare link" />
              ) : null}
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
          <SessionNotes session={session} />
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
          />
          {session.kind === "upload" ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={reprocessBusy}
                onClick={reprocess}
                className="min-h-10 rounded-lg border border-zinc-800 px-3 text-xs uppercase tracking-[0.16em] text-zinc-300 hover:border-zinc-600 disabled:opacity-50"
              >
                {reprocessBusy ? "Re-processing…" : "Re-process from original"}
              </button>
              {reprocessMsg ? (
                <p className="text-sm text-zinc-500">{reprocessMsg}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {laps.length ? (
          <LapChips
            laps={laps}
            selectedId={selected?.id}
            onSelect={(lap) => selectLap(lap)}
          />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
          <div className="space-y-4 lg:sticky lg:top-20">
            {theo ? (
              <div className="space-y-3">
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
            {laps.length ? (
              <LapList
                laps={laps}
                selectedId={selected?.id}
                onSelect={(lap) => selectLap(lap)}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
                No laps in this session.
              </p>
            )}
            <details className="group rounded-xl border border-zinc-800/80 bg-zinc-950/40">
              <summary className="cursor-pointer list-none px-4 py-3 text-xs uppercase tracking-[0.16em] text-zinc-400 marker:content-none [&::-webkit-details-marker]:hidden">
                YouTube onboard
                <span className="ml-2 text-zinc-600 group-open:hidden">
                  show
                </span>
              </summary>
              <div className="border-t border-zinc-900 px-3 pb-3 pt-2">
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
                  videos={session.videos ?? []}
                  onChange={(videos) => {
                    updateLocalSession(session.id, { videos });
                    window.location.reload();
                  }}
                />
              </div>
            </details>
          </div>

          <div className="min-w-0">
            {selectedLap ? (
              <SessionLapDetail
                sessionId={session.id}
                lap={{
                  id: selectedLap.id,
                  lap_number: selectedLap.lap_number,
                  lap_time_ms: selectedLap.lap_time_ms,
                  start_offset_sec: selectedLap.start_offset_sec,
                  telemetry: selectedLap.telemetry,
                }}
                siblingLaps={session.laps.map((item) => ({
                  id: item.id,
                  lap_number: item.lap_number,
                  lap_time_ms: item.lap_time_ms,
                  start_offset_sec: item.start_offset_sec,
                  telemetry: item.telemetry,
                }))}
                videos={youtubeVideos}
                videoParam={videoParam}
                trackId={session.trackId}
                sessionStartedAtMs={session.startedAtMs}
                onVideoChange={
                  session.kind === "upload"
                    ? (next) => {
                        const nextVideos = (session.videos ?? []).map((item) =>
                          item.id === next.id ? next : item,
                        );
                        if (!nextVideos.some((item) => item.id === next.id)) {
                          nextVideos.push(next);
                        }
                        updateLocalSession(session.id, {
                          videos: nextVideos.filter(
                            (v) => v.provider === "youtube",
                          ),
                        });
                      }
                    : undefined
                }
              />
            ) : null}
          </div>
        </div>
      </main>
    </>
  );
}

