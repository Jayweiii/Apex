"use client";

import { formatLapTime } from "@/lib/format";
import type { SessionVideo } from "@/lib/types";
import {
  sessionVideoFromYouTube,
  suggestVideosForSession,
} from "@/lib/youtube-match";
import { YOUTUBE_CATALOG } from "@/lib/youtube-catalog";
import { parseTitleHints, parseYouTubeId } from "@/lib/youtube";
import { useMemo, useState } from "react";

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
    laps: Array<{ id: string; lap_number: number; lap_time_ms: number }>;
  };
  videos: SessionVideo[];
  onChange: (videos: SessionVideo[]) => void | Promise<void>;
  /** Friends/public viewers: list only. */
  readOnly?: boolean;
  /** @deprecated Videos are YouTube-only; ignored. */
  persistCloud?: boolean;
}) {
  const [url, setUrl] = useState("");
  const [lapId, setLapId] = useState(session.laps[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const youtubeVideos = useMemo(
    () => videos.filter((v) => v.provider === "youtube" && v.youtubeId),
    [videos],
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

  async function attachFromUrl() {
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) {
      setError("Paste a YouTube watch / youtu.be / shorts URL or 11-char id");
      return;
    }
    setBusy(true);
    try {
      let title = url;
      try {
        const res = await fetch(
          `/api/youtube/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
        );
        if (res.ok) {
          const json = (await res.json()) as { title?: string };
          if (json.title) title = json.title;
        }
      } catch {
        // offline / blocked — still attach
      }
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
      const catalog = YOUTUBE_CATALOG.find((entry) => entry.youtubeId === id);
      const video = sessionVideoFromYouTube({
        youtubeId: id,
        title,
        lapId: chosenLap || null,
        durationSec: catalog?.durationSec,
        lapMs: hints.lapMs ?? catalog?.lapMs,
        syncSource: "lap_match",
      });
      // Drop any legacy local-mp4 rows when saving YouTube-only list.
      await onChange([...youtubeVideos, video]);
      setUrl("");
      setStatus("YouTube attached — open a lap to sync offset");
    } finally {
      setBusy(false);
    }
  }

  function attachSuggestion(youtubeId: string, suggestedLapId?: string) {
    const entry = YOUTUBE_CATALOG.find((item) => item.youtubeId === youtubeId);
    if (!entry) return;
    const video = sessionVideoFromYouTube({
      youtubeId: entry.youtubeId,
      title: entry.title,
      lapId: suggestedLapId ?? null,
      durationSec: entry.durationSec,
      lapMs: entry.lapMs,
      syncSource: "lap_match",
    });
    void onChange([...youtubeVideos, video]);
  }

  function removeVideo(id: string) {
    void onChange(youtubeVideos.filter((video) => video.id !== id));
  }

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Videos</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Attach onboard clips by pasting a YouTube URL. Sync offset is saved
            on the session so friends see the same alignment. Local GoPro files
            are for GPS telemetry only — upload the video to YouTube and paste
            the link.
          </p>
        </div>
      </div>

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
                className="min-h-10 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-black hover:bg-orange-400"
              >
                Attach
              </button>
            </li>
          ))}
        </ul>
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
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={attachFromUrl}
            className="min-h-11 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-black hover:bg-orange-400 disabled:opacity-50"
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
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800/60 px-3 py-3 text-sm"
              >
                <div>
                  <p className="text-zinc-100">
                    {video.title || video.youtubeId}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    youtube
                    {lap ? ` · lap ${lap.lap_number}` : ""}
                    {" · "}
                    {video.syncSource}
                    {" · offset "}
                    {video.offsetSec.toFixed(1)}s
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {video.lapId ? (
                    <a
                      href={`/sessions/${session.id}/laps/${video.lapId}?v=${video.id}`}
                      className="min-h-10 inline-flex items-center text-xs uppercase tracking-[0.16em] text-orange-400"
                    >
                      Open synced
                    </a>
                  ) : session.laps[0] ? (
                    <a
                      href={`/sessions/${session.id}/laps/${session.laps[0].id}?v=${video.id}`}
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
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-zinc-500">
          No YouTube videos attached yet.
        </p>
      )}
    </section>
  );
}
