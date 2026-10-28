import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import {
  parseStartFinishLine,
  startFinishSplitRef,
  type StartFinishLine,
  type StartFinishSplitRef,
} from "@/lib/start-finish-line";
import {
  builtinTrack,
  getTrack,
  resolveBuiltinAlias,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

export type { StartFinishLine, StartFinishSplitRef };

/**
 * Best-effort start/finish for lap detection:
 * 1) explicit tracks.start_finish (owner-edited gate) — includes heading
 * 2) track catalog / saved timing line lat/lon (custom id → builtin alias)
 * 3) first centerline point only as last-resort geometry assist
 * 4) null → caller falls back to first moving GPS sample
 *
 * Prefer catalog timing line over synthetic ellipse centerline[0] — the
 * builtin oval’s first point is not the Thunderhill West front-straight gate.
 */
export function resolveTrackStartFinish(
  trackId: string | null | undefined,
  sampleLaps?: TelemetryPoint[][],
  storedStartFinish?: unknown,
): StartFinishSplitRef | null {
  const fromStored = startFinishSplitRef(
    parseStartFinishLine(storedStartFinish),
  );
  if (fromStored) return fromStored;

  const alias = resolveBuiltinAlias(trackId);
  const track =
    (trackId ? getTrack(trackId) : null) ??
    (alias ? builtinTrack(alias) : null) ??
    (alias ? getTrack(alias) : null);
  if (track && Number.isFinite(track.lat) && Number.isFinite(track.lon)) {
    return { lat: track.lat, lon: track.lon };
  }

  // Last resort only — never prefer ellipse[0] over a known catalog gate.
  const centerline = resolveTrackCenterline(trackId, null, sampleLaps);
  if (centerline && centerline.length > 0) {
    return { lat: centerline[0].lat, lon: centerline[0].lon };
  }
  return null;
}

/** Full SF line (endpoints + heading) when stored or synthesizable. */
export function resolveTrackStartFinishLine(
  trackId: string | null | undefined,
  storedStartFinish?: unknown,
): StartFinishLine | null {
  const parsed = parseStartFinishLine(storedStartFinish);
  if (parsed) return parsed;
  const point = resolveTrackStartFinish(trackId);
  if (!point) return null;
  return {
    lat: point.lat,
    lon: point.lon,
    headingDeg: point.headingDeg ?? 0,
  };
}
