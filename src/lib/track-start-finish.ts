import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import {
  parseStartFinishLine,
  startFinishCrossingPoint,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import {
  builtinTrack,
  getTrack,
  resolveBuiltinAlias,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

export type { StartFinishLine };

/**
 * Best-effort start/finish for lap detection:
 * 1) explicit tracks.start_finish (owner-edited gate)
 * 2) first centerline point (track geometry / builtin)
 * 3) track catalog lat/lon (custom id → builtin alias, then shared/custom)
 * 4) null → caller falls back to first moving GPS sample
 */
export function resolveTrackStartFinish(
  trackId: string | null | undefined,
  sampleLaps?: TelemetryPoint[][],
  storedStartFinish?: unknown,
): { lat: number; lon: number } | null {
  const fromStored = startFinishCrossingPoint(
    parseStartFinishLine(storedStartFinish),
  );
  if (fromStored) return fromStored;

  const centerline = resolveTrackCenterline(trackId, null, sampleLaps);
  if (centerline && centerline.length > 0) {
    return { lat: centerline[0].lat, lon: centerline[0].lon };
  }
  const alias = resolveBuiltinAlias(trackId);
  const track =
    (trackId ? getTrack(trackId) : null) ??
    (alias ? builtinTrack(alias) : null) ??
    (alias ? getTrack(alias) : null);
  if (track && Number.isFinite(track.lat) && Number.isFinite(track.lon)) {
    return { lat: track.lat, lon: track.lon };
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
  return { lat: point.lat, lon: point.lon, headingDeg: 0 };
}
