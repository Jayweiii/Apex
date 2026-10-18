import { resolveTrackCenterline } from "@/lib/cloud-tracks";
import { getTrack } from "@/lib/tracks";
import type { TelemetryPoint } from "@/lib/types";

/**
 * Best-effort start/finish for lap detection:
 * 1) first centerline point (track geometry / builtin)
 * 2) track catalog lat/lon
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
  const track = trackId ? getTrack(trackId) : null;
  if (track && Number.isFinite(track.lat) && Number.isFinite(track.lon)) {
    return { lat: track.lat, lon: track.lon };
  }
  return null;
}
