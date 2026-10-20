import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import {
  builtinTrack,
  getTrack,
  resolveBuiltinAlias,
} from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

/**
 * Best-effort start/finish for lap detection:
 * 1) first centerline point (track geometry / builtin)
 * 2) track catalog lat/lon (custom id → builtin alias, then shared/custom)
 * 3) null → caller falls back to first moving GPS sample
 */
export function resolveTrackStartFinish(
  trackId: string | null | undefined,
  sampleLaps?: TelemetryPoint[][],
): { lat: number; lon: number } | null {
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
