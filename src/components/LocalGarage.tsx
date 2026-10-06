"use client";

import {
  CornerBreakdownTable,
  TheoreticalBestCard,
} from "@/components/AnalysisPanels";
import { AttributionCard } from "@/components/Attribution";
import { AppHeader } from "@/components/AppHeader";
import { LapCompare } from "@/components/LapCompare";
import { LapList } from "@/components/LapList";
import { LapCharts } from "@/components/LapCharts";
import { ShareLinkButton } from "@/components/ShareLinkButton";
import { cornerBreakdown, theoreticalBestLap } from "@/lib/analysis";
import { getLocalBlob } from "@/lib/blob-store";
import { loadCatalogSession } from "@/lib/catalog";
import { compareHref } from "@/lib/compare";
import { formatLapTime } from "@/lib/format";
import {
  getLocalSession,
  replaceLocalSessionLaps,
  type StoredSession,
} from "@/lib/local-store";
import { parseTelemetryCsv } from "@/lib/parse-telemetry";
import { getTrack } from "@/lib/tracks";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function CompareLink({
  sessionId,
  laps,
  focusId,
}: {
  sessionId: string;
  laps: { id: string; lap_time_ms: number }[];
  focusId?: string;
}) {
  const href = compareHref(sessionId, laps, focusId);
  if (!href) return null;
  return (
    <Link
      href={href}
      className="inline-flex min-h-10 items-center text-xs uppercase tracking-[0.18em] text-orange-400 hover:text-orange-300"
    >
      Compare laps
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
}: {
  id: string;
  initialRef?: string;
  initialOther?: string;
}) {
  const session = useLocalSession(id);

  if (session === undefined) return <LoadingShell label="Loading comparison…" />;
  if (!session) {
    return <MissingShell message="Session not found in this browser." />;
  }

  const laps = session.laps.map((lap) => ({
    id: lap.id,
    session_id: session.id,
    user_id: "local",
    lap_number: lap.lap_number,
    lap_time_ms: lap.lap_time_ms,
    telemetry: lap.telemetry,
  }));

  const href = compareHref(session.id, laps, initialOther);
  const refId = initialRef || laps[0]?.id;
  const otherId = initialOther || laps[1]?.id;
  const refLap = session.laps.find((lap) => lap.id === refId);
  const otherLap = session.laps.find((lap) => lap.id === otherId);
  const corners =
    refLap && otherLap && refLap.id !== otherLap.id
      ? cornerBreakdown(
          {
            lapNumber: refLap.lap_number,
            lapTimeMs: refLap.lap_time_ms,
            points: refLap.telemetry,
          },
          {
            lapNumber: otherLap.lap_number,
            lapTimeMs: otherLap.lap_time_ms,
            points: otherLap.telemetry,
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
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              Compare laps
            </h1>
            {href ? <ShareLinkButton path={href} label="Copy compare link" /> : null}
          </div>
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
          <SessionNotes session={session} />
        </div>
        <LapCompare laps={laps} initialRef={initialRef} initialOther={initialOther} />
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

  const theo = useMemo(() => {
    if (!session) return null;
    return theoreticalBestLap(
      session.laps.map((lap) => ({
        lapNumber: lap.lap_number,
        lapTimeMs: lap.lap_time_ms,
        points: lap.telemetry,
      })),
    );
  }, [session]);

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
  }));

  const track = session.trackId ? getTrack(session.trackId) : null;
  const comparePath = compareHref(session.id, laps);
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
        const updated = replaceLocalSessionLaps(current.id, lapsParsed);
        if (!updated) throw new Error("Could not update session");
        setReprocessMsg(`Re-processed ${lapsParsed.length} laps from the stored CSV.`);
        window.location.reload();
        return;
      }
      if (current.rawObjectKey) {
        const response = await fetch(
          `/api/storage/download?key=${encodeURIComponent(current.rawObjectKey)}`,
        );
        if (!response.ok) throw new Error("Could not download stored CSV");
        const lapsParsed = parseTelemetryCsv(await response.text());
        replaceLocalSessionLaps(current.id, lapsParsed);
        setReprocessMsg(`Re-processed ${lapsParsed.length} laps.`);
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

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-6 sm:py-8">
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
            <p className="text-sm text-zinc-500">
              {session.car ? `${session.car} · ` : ""}
              {session.laps.length} laps
              {Number.isFinite(best) ? ` · best ${formatLapTime(best)}` : ""}
              {session.sourceKind === "gopro" ? " · GoPro" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <ShareLinkButton path={`/sessions/${session.id}`} />
              {comparePath ? (
                <ShareLinkButton path={comparePath} label="Copy compare link" />
              ) : null}
              <CompareLink sessionId={session.id} laps={laps} />
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
        {theo ? <TheoreticalBestCard result={theo} /> : null}
        {laps.length ? (
          <LapList sessionId={session.id} laps={laps} />
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No laps in this session.
          </p>
        )}
      </main>
    </>
  );
}

export function LocalLap({
  sessionId,
  lapId,
}: {
  sessionId: string;
  lapId: string;
}) {
  const session = useLocalSession(sessionId);
  const lap = session?.laps.find((item) => item.id === lapId);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    async function loadVideo() {
      if (!session) return;
      if (session.videoObjectKey) {
        setVideoSrc(
          `/api/storage/download?key=${encodeURIComponent(session.videoObjectKey)}`,
        );
        return;
      }
      if (session.videoLocalKey) {
        const blob = await getLocalBlob(session.videoLocalKey);
        if (!blob || cancelled) return;
        url = URL.createObjectURL(blob);
        setVideoSrc(url);
      }
    }
    loadVideo().catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session]);

  if (session === undefined) return <LoadingShell label="Loading lap…" />;
  if (!session || !lap) {
    return <MissingShell message="Lap not found in this browser." />;
  }

  const peak = lap.telemetry.reduce((max, point) => Math.max(max, point.speed), 0);
  const corners = cornerBreakdown({
    lapNumber: lap.lap_number,
    lapTimeMs: lap.lap_time_ms,
    points: lap.telemetry,
  });

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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
                Lap {lap.lap_number}
              </h1>
              <p className="mt-1 font-mono text-3xl text-orange-400 sm:text-4xl">
                {formatLapTime(lap.lap_time_ms)}
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <p className="text-sm text-zinc-500">Peak {peak.toFixed(0)} km/h</p>
              <div className="flex flex-wrap gap-2">
                <ShareLinkButton
                  path={`/sessions/${session.id}/laps/${lap.id}`}
                  label="Copy lap link"
                />
                <CompareLink
                  sessionId={session.id}
                  laps={session.laps.map((item) => ({
                    id: item.id,
                    lap_time_ms: item.lap_time_ms,
                  }))}
                  focusId={lap.id}
                />
              </div>
            </div>
          </div>
          <SessionNotes session={session} />
          <AttributionCard
            kind={session.kind ?? "upload"}
            attribution={session.attribution}
            compact
          />
        </div>
        {lap.telemetry.length ? (
          <LapCharts
            points={lap.telemetry}
            label={`Lap ${lap.lap_number}`}
            videoSrc={videoSrc}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">
            No speed samples on this lap.
          </p>
        )}
        <CornerBreakdownTable
          corners={corners}
          referenceLabel={`Lap ${lap.lap_number}`}
        />
      </main>
    </>
  );
}
