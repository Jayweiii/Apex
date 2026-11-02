"use client";

import { formatLapTime } from "@/lib/format";
import { sessionLapHref } from "@/lib/session-lap-url";
import {
  parseBulkYouTubeUrls,
  videoCoverage,
} from "@/lib/pick-session-video";
import type { SessionVideo } from "@/lib/types";
import {
  sessionVideoFromYouTube,
  suggestVideosForSession,
} from "@/lib/youtube-match";
import { YOUTUBE_CATALOG } from "@/lib/youtube-catalog";
import { parseTitleHints, parseYouTubeId } from "@/lib/youtube";
import { useMemo, useState } from "react";

const NUDGE = 0.1;

async function fetchOEmbedTitle(id: string, fallback: string): Promise<string> {
  try {
    const res = await fetch(
      `/api/youtube/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { title?: string };
      if (json.title) return json.title;
    }
  } catch {
    // offline / blocked
  }
  return fallback;
}

export function SessionVideosCard({
  session,
  videos,
  onChange,
  readOnly = false,
}: {
  session: {
    id: string;
    trackId?: string;
    sessionDate?: string;
    startedAtMs?: number;
    created_at: string;
    laps: Array<{
      id: string;
      lap_number: number;
      lap_time_ms: number;
      start_offset_sec?: number | null;
    }>;
  };
  videos: SessionVideo[];
  onChange: (videos: SessionVideo[]) => void | Promise<void>;
  readOnly?: boolean;
  /** @deprecated Videos are YouTube-only; ignored. */
  persistCloud?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [lapId, setLapId] = useState(session.laps[0]?.id ?? "");
  const [bulkText, setBulkText] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const youtubeVideos = useMemo(
    () => videos.filter((v) => v.provider === "youtube" && v.youtubeId),
    [videos],
  );

  const coverage = useMemo(
    () =>
      videoCoverage(
        youtubeVideos,
        session.laps.map((l) => l.id),
      ),
    [youtubeVideos, session.laps],
  );

  const suggestions = useMemo(
    () =>
      suggestVideosForSession(
        {
          trackId: session.trackId,
          sessionDate: session.sessionDate,
          startedAtMs: session.startedAtMs,
          createdAt: session.created_at,
          laps: session.laps,
        },
        YOUTUBE_CATALOG,
      ).filter(
        (item) =>
          !youtubeVideos.some((v) => v.youtubeId === item.entry.youtubeId),
      ),
    [session, youtubeVideos],
  );

  function replaceVideos(next: SessionVideo[]) {
    return onChange(
      next.filter((v) => v.provider === "youtube" && v.youtubeId),
    );
  }

  function upsertVideo(video: SessionVideo) {
    const withoutDup = youtubeVideos.filter((v) => {
      if (v.id === video.id) return false;
      if (video.lapId) return v.lapId !== video.lapId;
      return v.lapId != null && v.lapId !== "";
    });
    const kept = video.lapId
      ? withoutDup
      : withoutDup.filter((v) => v.lapId != null && v.lapId !== "");
    return replaceVideos([...kept, video]);
  }

  async function attachFromUrl() {
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) {
      setError("Paste a YouTube watch / youtu.be / shorts URL or 11-char id");
      return;
    }
    setBusy(true);
    try {
      const title = await fetchOEmbedTitle(id, url);
      const hints = parseTitleHints(title);
      let chosenLap = lapId;
      if (hints.lapMs != null) {
        const match = session.laps.find(
          (lap) =>
            Math.abs(lap.lap_time_ms - hints.lapMs!) <=
            Math.max(hints.lapPrecisionMs, 150),
        );
        if (match) chosenLap = match.id;
      }
      const lap = session.laps.find((l) => l.id === chosenLap);
      const catalog = YOUTUBE_CATALOG.find((entry) => entry.youtubeId === id);
      const video = sessionVideoFromYouTube({
        youtubeId: id,
        youtubeUrl: url.trim(),
        title,
        lapId: chosenLap || null,
        lapIndex: lap?.lap_number ?? null,
        lapStartOffsetSec: lap?.start_offset_sec ?? 0,
        durationSec: catalog?.durationSec,
        lapMs: hints.lapMs ?? catalog?.lapMs,
        syncSource: "lap_match",
      });
      await upsertVideo(video);
      setUrl("");
      setStatus(
        chosenLap
          ? `Attached to lap ${lap?.lap_number ?? ""} — point-match on the lap panel`
          : "Session-level YouTube attached — open a lap and Sync here",
      );
    } finally {
      setBusy(false);
    }
  }

  async function attachBulk() {
    setError(null);
    const ids = parseBulkYouTubeUrls(bulkText);
    if (!ids.length) {
      setError("Paste one YouTube URL per line (assigned to laps in order)");
      return;
    }
    const ordered = [...session.laps].sort(
      (a, b) => a.lap_number - b.lap_number,
    );
    if (!ordered.length) {
      setError("No laps to assign");
      return;
    }
    setBusy(true);
    try {
      let next = [...youtubeVideos];
      const assigned: number[] = [];
      for (let i = 0; i < ids.length && i < ordered.length; i += 1) {
        const ytId = ids[i];
        const lap = ordered[i];
        const title = await fetchOEmbedTitle(ytId, ytId);
        const video = sessionVideoFromYouTube({
          youtubeId: ytId,
          youtubeUrl: `https://www.youtube.com/watch?v=${ytId}`,
          title,
          lapId: lap.id,
          lapIndex: lap.lap_number,
          lapStartOffsetSec: lap.start_offset_sec ?? 0,
          syncSource: "lap_match",
          offsetSec: 0,
        });
        next = next.filter((v) => v.lapId !== lap.id);
        next.push(video);
        assigned.push(lap.lap_number);
      }
      await replaceVideos(next);
      setBulkText("");
      setShowBulk(false);
      setStatus(
        `Assigned ${assigned.length} video${assigned.length === 1 ? "" : "s"} to laps ${assigned.join(", ")}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function attachSuggestion(youtubeId: string, suggestedLapId?: string) {
    const entry = YOUTUBE_CATALOG.find((item) => item.youtubeId === youtubeId);
    if (!entry) return;
    const lap = session.laps.find((l) => l.id === suggestedLapId);
    const video = sessionVideoFromYouTube({
      youtubeId: entry.youtubeId,
      title: entry.title,
      lapId: suggestedLapId ?? null,
      lapIndex: lap?.lap_number ?? null,
      lapStartOffsetSec: lap?.start_offset_sec ?? 0,
      durationSec: entry.durationSec,
      lapMs: entry.lapMs,
      syncSource: "lap_match",
    });
    void upsertVideo(video);
  }

  function removeVideo(id: string) {
    void replaceVideos(youtubeVideos.filter((video) => video.id !== id));
  }

  function patchVideo(id: string, patch: Partial<SessionVideo>) {
    void replaceVideos(
      youtubeVideos.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Videos</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Paste a YouTube URL per lap (or one session-level clip for many
            laps). Point-match sync on the lap panel; offset is saved so
            friends see the same alignment. YouTube only — no file storage.
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            onClick={() => setShowBulk((v) => !v)}
            className="min-h-10 text-xs uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-200"
          >
            {showBulk ? "Hide bulk" : "Bulk paste"}
          </button>
        ) : null}
      </div>

      {session.laps.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {session.laps.map((lap) => {
            const has =
              coverage.byLapId.has(lap.id) || Boolean(coverage.sessionLevel);
            const dedicated = coverage.byLapId.has(lap.id);
            return (
              <span
                key={lap.id}
                title={
                  dedicated
                    ? "Lap has its own YouTube"
                    : coverage.sessionLevel
                      ? "Covered by session-level video"
                      : "No video"
                }
                className={`inline-flex min-h-8 items-center rounded-md px-2 font-mono text-xs ${
                  dedicated
                    ? "bg-orange-500/20 text-orange-300"
                    : has
                      ? "bg-zinc-800 text-zinc-300"
                      : "bg-zinc-950 text-zinc-600 ring-1 ring-zinc-800"
                }`}
              >
                L{lap.lap_number}
                {dedicated ? " · yt" : has ? " · sess" : ""}
              </span>
            );
          })}
        </div>
      ) : null}

      {!readOnly && suggestions.length ? (
        <ul className="mt-4 grid gap-2">
          {suggestions.slice(0, 4).map((item) => (
            <li
              key={item.entry.youtubeId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/80 px-3 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm text-zinc-100">{item.entry.title}</p>
                <p className="mt-1 text-xs text-zinc-500">{item.reason}</p>
              </div>
              <button
                type="button"
                onClick={() =>
                  attachSuggestion(item.entry.youtubeId, item.lapId)
                }
                className="apex-btn apex-btn--primary"
              >
                Attach
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!readOnly && showBulk ? (
        <div className="mt-4 space-y-2">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={4}
            placeholder={
              "https://youtu.be/…\nhttps://youtu.be/…\n(one URL per line → laps in order)"
            }
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void attachBulk()}
            className="apex-btn apex-btn--primary apex-btn--cta"
          >
            {busy ? "Assigning…" : "Assign to laps in order"}
          </button>
        </div>
      ) : null}

      {!readOnly ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtu.be/BI0ZwJiqYk8"
            className="min-h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none ring-orange-500/40 focus:border-orange-500/70 focus:ring-2"
          />
          <select
            value={lapId}
            onChange={(e) => setLapId(e.target.value)}
            className="min-h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100"
          >
            <option value="">Whole session</option>
            {session.laps.map((lap) => (
              <option key={lap.id} value={lap.id}>
                Lap {lap.lap_number} · {formatLapTime(lap.lap_time_ms)}
                {coverage.byLapId.has(lap.id) ? " · has video" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void attachFromUrl()}
            className="apex-btn apex-btn--primary apex-btn--cta"
          >
            {busy ? "…" : "Add YouTube"}
          </button>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
      {status ? <p className="mt-2 text-sm text-zinc-400">{status}</p> : null}

      {youtubeVideos.length ? (
        <ul className="mt-4 grid gap-2">
          {youtubeVideos.map((video) => {
            const lap = session.laps.find((item) => item.id === video.lapId);
            return (
              <li
                key={video.id}
                className="rounded-xl border border-zinc-800/60 px-3 py-3 text-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-zinc-100">
                      {video.title || video.youtubeId}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {lap
                        ? `lap ${lap.lap_number}`
                        : "session-level (all laps)"}
                      {" · "}
                      {video.syncSource}
                      {" · offset "}
                      {video.offsetSec.toFixed(1)}s
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lap ? (
                      <a
                        href={sessionLapHref(session.id, lap, { videoId: video.id })}
                        className="min-h-10 inline-flex items-center text-xs uppercase tracking-[0.16em] text-orange-400"
                      >
                        Open synced
                      </a>
                    ) : session.laps[0] ? (
                      <a
                        href={sessionLapHref(session.id, session.laps[0], { videoId: video.id })}
                        className="min-h-10 inline-flex items-center text-xs uppercase tracking-[0.16em] text-orange-400"
                      >
                        Open synced
                      </a>
                    ) : null}
                    {!readOnly ? (
                      <button
                        type="button"
                        onClick={() => removeVideo(video.id)}
                        className="min-h-10 text-xs uppercase tracking-[0.16em] text-zinc-500 hover:text-zinc-300"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>

                {!readOnly ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex min-h-8 items-center rounded-md px-2 text-[11px] uppercase tracking-[0.12em] ${
                        video.syncSource === "unsynced"
                          ? "bg-zinc-800 text-zinc-400"
                          : "bg-emerald-500/15 text-emerald-300"
                      }`}
                    >
                      {video.syncSource === "unsynced" ? "Not synced" : "Synced"}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        patchVideo(video.id, {
                          offsetSec: video.offsetSec - NUDGE,
                          syncSource: "manual",
                        })
                      }
                      className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-300 hover:border-zinc-600"
                    >
                      −0.1s
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchVideo(video.id, {
                          offsetSec: video.offsetSec + NUDGE,
                          syncSource: "manual",
                        })
                      }
                      className="min-h-9 rounded-md border border-zinc-800 px-2.5 font-mono text-xs text-zinc-300 hover:border-zinc-600"
                    >
                      +0.1s
                    </button>
                    <span className="text-xs text-zinc-500">
                      Point-match on the lap panel (chart ↔ pause ↔ Sync here)
                    </span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No YouTube videos attached yet.
        </p>
      )}

      {!readOnly && session.laps.length > 0 ? (
        <div className="mt-5 border-t border-zinc-900 pt-4">
          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Per-lap links
          </p>
          <ul className="mt-2 divide-y divide-zinc-900">
            {session.laps.map((lap) => {
              const existing = coverage.byLapId.get(lap.id);
              return (
                <li
                  key={lap.id}
                  className="flex flex-wrap items-center gap-2 py-2 text-sm"
                >
                  <span className="w-14 font-mono text-zinc-400">
                    L{String(lap.lap_number).padStart(2, "0")}
                  </span>
                  <span className="w-20 font-mono text-zinc-500">
                    {formatLapTime(lap.lap_time_ms)}
                  </span>
                  {existing ? (
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {existing.title || existing.youtubeId}
                      <span className="ml-2 text-xs text-zinc-600">
                        @{existing.offsetSec.toFixed(1)}s
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1 text-xs text-zinc-600">
                      {coverage.sessionLevel
                        ? "session-level video"
                        : "no video"}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setLapId(lap.id)}
                    className="min-h-9 text-xs uppercase tracking-[0.14em] text-orange-400"
                  >
                    {existing ? "Edit" : "Paste"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
