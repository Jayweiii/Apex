/**
 * Drive minigame scores — LOCAL ONLY game leaderboard.
 * Keys are namespaced under apex.drive.* so they NEVER mix with real lap boards.
 */

import type { DriveGhostLap, DrivePoint } from "@/lib/drive/types";

const PB_PREFIX = "apex.drive.pb.";
const GHOST_PREFIX = "apex.drive.ghost.";
const BOARD_PREFIX = "apex.drive.leaderboard.";

export type DriveLeaderboardEntry = {
  name: string;
  timeMs: number;
  at: string; // ISO
  /** Marks this as a game time — never feed into real leaderboards. */
  source: "drive-minigame";
};

export function drivePbKey(trackId: string) {
  return `${PB_PREFIX}${trackId}`;
}

export function loadPersonalBest(trackId: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(drivePbKey(trackId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function savePersonalBest(trackId: string, timeMs: number): boolean {
  if (typeof window === "undefined") return false;
  if (!Number.isFinite(timeMs) || timeMs < 1000) return false;
  const prev = loadPersonalBest(trackId);
  if (prev != null && timeMs >= prev) return false;
  try {
    localStorage.setItem(drivePbKey(trackId), String(Math.round(timeMs)));
    return true;
  } catch {
    return false;
  }
}

export function loadPlayerGhost(trackId: string): DriveGhostLap | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${GHOST_PREFIX}${trackId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DriveGhostLap;
    if (
      !parsed ||
      parsed.kind !== "player" ||
      !Array.isArray(parsed.samples) ||
      parsed.samples.length < 10
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePlayerGhost(
  trackId: string,
  timeMs: number,
  samples: DrivePoint[],
) {
  if (typeof window === "undefined") return;
  if (samples.length < 10) return;
  const prev = loadPersonalBest(trackId);
  // Only overwrite ghost when this lap is a new PB (or first).
  if (prev != null && timeMs > prev) return;
  const ghost: DriveGhostLap = {
    label: "Your best",
    kind: "player",
    timeMs,
    samples,
  };
  try {
    localStorage.setItem(`${GHOST_PREFIX}${trackId}`, JSON.stringify(ghost));
  } catch {
    // quota — ignore
  }
}

export function loadGameLeaderboard(trackId: string): DriveLeaderboardEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${BOARD_PREFIX}${trackId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriveLeaderboardEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          e.source === "drive-minigame" &&
          typeof e.timeMs === "number" &&
          e.timeMs > 0,
      )
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function submitGameTime(
  trackId: string,
  timeMs: number,
  name = "You",
): DriveLeaderboardEntry[] {
  if (typeof window === "undefined") return [];
  const entry: DriveLeaderboardEntry = {
    name: name.trim() || "You",
    timeMs: Math.round(timeMs),
    at: new Date().toISOString(),
    source: "drive-minigame",
  };
  const list = loadGameLeaderboard(trackId);
  list.push(entry);
  list.sort((a, b) => a.timeMs - b.timeMs);
  const trimmed = list.slice(0, 20);
  try {
    localStorage.setItem(`${BOARD_PREFIX}${trackId}`, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
  return trimmed;
}

/** Sample ghost position at elapsed ms (linear interpolate). */
export function sampleGhost(
  ghost: DriveGhostLap,
  elapsedMs: number,
): DrivePoint | null {
  const samples = ghost.samples;
  if (!samples.length) return null;
  if (elapsedMs <= (samples[0]!.t ?? 0)) return samples[0]!;
  const last = samples[samples.length - 1]!;
  if (elapsedMs >= (last.t ?? ghost.timeMs)) return last;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const ta = a.t ?? 0;
    const tb = b.t ?? ta;
    if (elapsedMs <= tb) {
      const u = tb === ta ? 0 : (elapsedMs - ta) / (tb - ta);
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        t: elapsedMs,
      };
    }
  }
  return last;
}
