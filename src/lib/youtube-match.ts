import type { SessionVideo } from "./types";
import { parseTitleHints, type TitleHints } from "./youtube";

export type YoutubeCatalogEntry = {
  youtubeId: string;
  title: string;
  uploadedAt: string;
  durationSec: number;
  trackId: string | null;
  lapMs: number | null;
  lapPrecisionMs: number | null;
  kind: string;
  car?: string | null;
};

export type SessionMatchInput = {
  trackId?: string | null;
  sessionDate?: string | null;
  startedAtMs?: number | null;
  createdAt?: string | null;
  laps: Array<{ id: string; lap_time_ms: number }>;
};

export type VideoSuggestion = {
  entry: YoutubeCatalogEntry;
  score: number;
  lapId?: string;
  reason: string;
  hints: TitleHints;
};

const DATE_WINDOW_DAYS = 120;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms =
    Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Suggest catalog videos for a session: same track, lap time within title
 * precision, session date on/before upload and within ~120 days.
 */
export function suggestVideosForSession(
  session: SessionMatchInput,
  catalog: YoutubeCatalogEntry[],
): VideoSuggestion[] {
  const sessionDate =
    session.sessionDate ??
    (session.startedAtMs != null
      ? dateOnly(new Date(session.startedAtMs).toISOString())
      : session.createdAt
        ? dateOnly(session.createdAt)
        : null);

  const suggestions: VideoSuggestion[] = [];

  for (const entry of catalog) {
    if (!entry.trackId) continue;
    if (session.trackId && entry.trackId !== session.trackId) continue;

    const hints = parseTitleHints(entry.title);
    let score = 0;
    const reasons: string[] = [];
    let lapId: string | undefined;

    if (session.trackId && entry.trackId === session.trackId) {
      score += 10;
      reasons.push("same track");
    }

    if (entry.lapMs != null && session.laps.length) {
      const precision = Math.max(entry.lapPrecisionMs ?? 150, 150);
      let bestDelta = Number.POSITIVE_INFINITY;
      let bestLap: (typeof session.laps)[0] | null = null;
      for (const lap of session.laps) {
        const delta = Math.abs(lap.lap_time_ms - entry.lapMs);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestLap = lap;
        }
      }
      if (bestLap && bestDelta <= precision) {
        score += 50 - bestDelta / 100;
        lapId = bestLap.id;
        reasons.push(
          `lap time within ${precision} ms (Δ ${Math.round(bestDelta)} ms)`,
        );
      } else if (bestLap && bestDelta <= 2000) {
        score += 5;
        reasons.push(`nearby lap time (Δ ${Math.round(bestDelta)} ms)`);
      }
    }

    if (sessionDate && entry.uploadedAt) {
      const uploaded = dateOnly(entry.uploadedAt);
      const deltaDays = daysBetween(sessionDate, uploaded);
      if (deltaDays >= 0 && deltaDays <= DATE_WINDOW_DAYS) {
        score += 20 - deltaDays / 10;
        reasons.push(`session ≤ upload within ${Math.round(deltaDays)} d`);
      } else if (deltaDays < 0 && deltaDays > -14) {
        // slight clock skew / timezone: still weak positive
        score += 2;
        reasons.push("upload slightly before session date");
      } else if (!session.startedAtMs && session.createdAt) {
        score += 1;
        reasons.push("weak created_at hint only");
      }
    } else if (!session.startedAtMs) {
      // old uploads: lap-time match only
      if (lapId) score += 5;
    }

    if (score < 10) continue;
    suggestions.push({
      entry,
      score,
      lapId,
      reason: reasons.join("; ") || "possible match",
      hints,
    });
  }

  return suggestions.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title));
}

/** Build a SessionVideo from a catalog entry / pasted link. */
export function sessionVideoFromYouTube(options: {
  youtubeId: string;
  title?: string;
  lapId?: string | null;
  durationSec?: number;
  lapMs?: number | null;
  syncSource?: SessionVideo["syncSource"];
}): SessionVideo {
  const lapMs = options.lapMs ?? null;
  const durationSec = options.durationSec;
  // Initial guess: center the lap in the clip padding.
  let offsetSec = 0;
  if (durationSec != null && lapMs != null && durationSec * 1000 > lapMs) {
    offsetSec = (durationSec - lapMs / 1000) / 2;
  }
  return {
    id: crypto.randomUUID(),
    provider: "youtube",
    youtubeId: options.youtubeId,
    title: options.title,
    lapId: options.lapId ?? null,
    offsetSec,
    rate: 1,
    syncSource: options.syncSource ?? "lap_match",
  };
}
