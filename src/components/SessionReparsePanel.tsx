"use client";

import { BusyIndicator } from "@/components/BusyIndicator";
import type { GpsQuality } from "@/lib/gps-quality";
import { parseGoProChapters, isGoProMediaFilename } from "@/lib/parse-gopro";
import {
  detectGpsLoggerFormat,
  parseGpsLoggerFile,
} from "@/lib/parse-gps-logger";
import {
  buildReparseSaveBody,
  REPARSE_BODY_MAX_BYTES,
  reparseBodyTooLargeMessage,
} from "@/lib/reparse-save-body";
import {
  compactSourceGps,
  compactSourceGpsIfDense,
  reparseLapsFromPoints,
  resolveGpsForReparse,
  type SourceGpsStored,
} from "@/lib/session-reparse";
import { TRACKS } from "@/lib/tracks";
import { resolveTrackStartFinish } from "@/lib/track-start-finish";
import type { LapRow, TelemetryPoint } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

/**
 * Owner-only re-split. Uses sessions.source_gps when dense enough; otherwise
 * prompts for the original GoPro LRV/MP4 or GPS log (GPS only). BusyIndicator
 * only — no beforeunload.
 */
export type ReparseStagePayload = {
  laps: Array<{
    lapNumber: number;
    lapTimeMs: number;
    points: TelemetryPoint[];
    startOffsetSec?: number;
    startedAtMs?: number;
  }>;
  sourceGps?: SourceGpsStored | null;
  trackId?: string | null;
  startFinish?: {
    lat: number;
    lon: number;
    headingDeg?: number;
    locked?: boolean;
  } | null;
  startedAtMs?: number;
  sessionDate?: string;
  gpsQuality?: GpsQuality;
};

export function SessionReparsePanel({
  sessionId,
  trackId,
  sourceGps,
  laps,
  startedAtMs,
  storedStartFinish,
  onDone,
  /** When set, re-parse stages results for explicit Save instead of POSTing. */
  onStage,
  /**
   * Toolbar click: dense source_gps → re-split immediately; otherwise open the
   * original LRV/CSV file picker. Runs once per mount.
   */
  autoStart = false,
}: {
  sessionId: string;
  trackId?: string | null;
  sourceGps?: unknown;
  laps: LapRow[];
  startedAtMs?: number;
  /** Prefer tracks.start_finish (owner-edited gate) over catalog. */
  storedStartFinish?: unknown;
  onDone: (result: { lapCount: number }) => void;
  onStage?: (payload: ReparseStagePayload) => void;
  autoStart?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const autoStartedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needFile, setNeedFile] = useState(false);
  const [sfLat, setSfLat] = useState("");
  const [sfLon, setSfLon] = useState("");
  const [pickedTrack, setPickedTrack] = useState(trackId ?? "");

  const density = resolveGpsForReparse({ sourceGps, laps }).density;

  async function runReparse(opts?: { file?: File }) {
    setBusy(true);
    setError(null);
    setProgress("Preparing re-split…");
    try {
      const track = pickedTrack || trackId || null;
      const startFinish =
        sfLat.trim() && sfLon.trim()
          ? { lat: Number(sfLat), lon: Number(sfLon) }
          : resolveTrackStartFinish(track, undefined, storedStartFinish);

      let clientLaps:
        | Array<{
            lapNumber: number;
            lapTimeMs: number;
            points: TelemetryPoint[];
            startOffsetSec?: number;
            startedAtMs?: number;
          }>
        | undefined;
      let nextSourceGps: SourceGpsStored | null | undefined;
      let gpsQuality: GpsQuality | undefined;
      let nextStartedAtMs: number | undefined;
      let sessionDate: string | undefined;

      if (opts?.file) {
        const file = opts.file;
        setProgress(`Reading ${file.name} (GPS only)…`);
        if (isGoProMediaFilename(file.name)) {
          const parsed = await parseGoProChapters([file], {
            onProgress: (percent) => {
              setProgress(
                `Extracting GPS… ${Math.round(percent)}% (video not uploaded)`,
              );
            },
            trackId: track,
            startFinish,
          });
          clientLaps = parsed.laps;
          nextSourceGps = parsed.sourcePoints?.length
            ? compactSourceGps(parsed.sourcePoints)
            : undefined;
          gpsQuality = parsed.gpsQuality;
          nextStartedAtMs = parsed.startedAtMs;
          sessionDate = parsed.sessionDate;
        } else {
          const peek = await file.slice(0, 12000).text();
          const kind = detectGpsLoggerFormat(file.name, peek);
          if (kind === "unknown" || kind === "mp4" || kind === "dlap") {
            throw new Error(
              "Choose a GoPro LRV/MP4, GPX, VBO, or GPS CSV — video is never uploaded.",
            );
          }
          const parsed = await parseGpsLoggerFile(file, file.name, {
            startFinish,
          });
          clientLaps = parsed.laps;
          nextSourceGps = parsed.sourcePoints?.length
            ? compactSourceGps(parsed.sourcePoints)
            : undefined;
          gpsQuality = parsed.gpsQuality;
          nextStartedAtMs = parsed.startedAtMs;
          sessionDate = parsed.sessionDate;
        }
        setProgress(
          onStage
            ? `Split ${clientLaps.length} laps — tap Save to keep`
            : `Split ${clientLaps.length} laps — saving…`,
        );
      } else {
        const resolved = resolveGpsForReparse({ sourceGps, laps });
        if (!resolved.density.ok) {
          setNeedFile(true);
          throw new Error(resolved.density.reason);
        }
        setProgress("Detecting SF crossings…");
        try {
          const split = reparseLapsFromPoints(resolved.points, {
            sessionStartedAtMs: startedAtMs,
            startFinish,
            trackId: track,
          });
          clientLaps = split.laps;
          if (resolved.from === "source_gps") {
            // Re-encode dense source_gps only — never promote stitched laps.
            nextSourceGps = compactSourceGpsIfDense(resolved.points);
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Lap split failed";
          setError(
            `${message} Enter start/finish lat/lon below, or re-select the original file.`,
          );
          return;
        }
        setProgress(
          onStage
            ? `Split ${clientLaps.length} laps — tap Save to keep`
            : `Split ${clientLaps.length} laps — saving…`,
        );
      }

      if (onStage) {
        onStage({
          laps: clientLaps,
          sourceGps: nextSourceGps,
          trackId: track,
          startFinish,
          startedAtMs: nextStartedAtMs ?? startedAtMs,
          sessionDate,
          gpsQuality,
        });
        setProgress(null);
        onDone({ lapCount: clientLaps.length });
        return;
      }

      const { body: reparseBody, bytes: reparseBytes } = buildReparseSaveBody({
        laps: clientLaps,
        sourceGps: nextSourceGps,
        trackId: track,
        startFinish,
        startedAtMs: nextStartedAtMs ?? startedAtMs,
        sessionDate,
        gpsQuality,
      });
      if (reparseBytes > REPARSE_BODY_MAX_BYTES) {
        throw new Error(reparseBodyTooLargeMessage(reparseBytes));
      }
      const response = await fetch(`/api/sessions/${sessionId}/reparse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(reparseBody),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        lapCount?: number;
        needFile?: boolean;
      };
      if (!response.ok) {
        if (payload.needFile || payload.code === "gps_too_coarse") {
          setNeedFile(true);
        }
        const statusHint =
          response.status === 413
            ? " (payload too large)"
            : response.status === 401
              ? " (sign in required)"
              : ` (HTTP ${response.status})`;
        throw new Error((payload.error ?? "Re-parse failed") + statusHint);
      }
      setProgress(null);
      onDone({ lapCount: payload.lapCount ?? clientLaps.length });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-parse failed");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    if (density.ok) {
      void runReparse();
      return;
    }
    setNeedFile(true);
    // Defer so the hidden file input is mounted before the picker opens.
    const id = window.requestAnimationFrame(() => {
      fileRef.current?.click();
    });
    return () => window.cancelAnimationFrame(id);
    // Intentionally once on open — density/runReparse are stable for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  return (
    <div className="space-y-3" data-testid="reparse-flow">
      <p className="text-sm text-zinc-400">
        Re-split laps from full GPS after upload. Session id, YouTube links,
        sync offsets, trims, and excludes are kept when lap numbers match.
        {onStage
          ? " Results stay unsaved until you tap Save on the session."
          : null}
      </p>

      {!density.ok || needFile ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {density.reason ??
            "Re-select the original GoPro LRV/MP4 or GPS log (GPS only)."}
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Stored GPS ≈ {density.hz.toFixed(1)} Hz over{" "}
          {Math.round(density.durationSec)}s — dense enough to re-split.
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-500">Track (for SF)</span>
        <select
          value={pickedTrack}
          disabled={busy}
          onChange={(event) => setPickedTrack(event.target.value)}
          className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
        >
          <option value="">Auto / current</option>
          {TRACKS.map((track) => (
            <option key={track.id} value={track.id}>
              {track.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">SF lat (if auto fails)</span>
          <input
            value={sfLat}
            disabled={busy}
            onChange={(event) => setSfLat(event.target.value)}
            inputMode="decimal"
            placeholder="39.53905"
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 font-mono text-sm text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-500">SF lon</span>
          <input
            value={sfLon}
            disabled={busy}
            onChange={(event) => setSfLon(event.target.value)}
            inputMode="decimal"
            placeholder="-122.3387"
            className="min-h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 font-mono text-sm text-zinc-100"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !density.ok}
          onClick={() => void runReparse()}
          className="min-h-10 rounded-lg bg-orange-500 px-3 text-xs font-semibold uppercase tracking-[0.14em] text-black hover:bg-orange-400 disabled:opacity-40"
        >
          Re-parse laps
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs uppercase tracking-[0.14em] text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          Re-select GPS file
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".mp4,.lrv,.mov,.gpx,.vbo,.csv,.json,video/mp4"
          className="hidden"
          aria-label="Original GoPro LRV or GPS CSV"
          data-testid="reparse-file-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void runReparse({ file });
          }}
        />
      </div>

      <BusyIndicator busy={busy} message={progress} />
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
