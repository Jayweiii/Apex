import type { LatLon } from "./map-match";

/**
 * Built-in reference centerlines for known circuits.
 * Thunderhill East: approximate closed loop (~4.6 km) around the published
 * circuit reference point. Used when tracks.centerline is empty; OSM fetch
 * is optional and may be unavailable in restricted environments.
 */
function ellipseLoop(
  centerLat: number,
  centerLon: number,
  radiusNorthM: number,
  radiusEastM: number,
  count: number,
  wobble = 0.18,
): LatLon[] {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const cos = Math.cos(toRad(centerLat)) || 1;
  const out: LatLon[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    // Mild radial modulation to avoid a perfect oval (East has infield kinks).
    const mod =
      1 +
      wobble * Math.sin(a * 3) * 0.55 +
      wobble * Math.cos(a * 2) * 0.35;
    const north = Math.sin(a) * radiusNorthM * mod;
    const east = Math.cos(a) * radiusEastM * mod;
    out.push({
      lat: centerLat + toDeg(north / 6371000),
      lon: centerLon + toDeg(east / (6371000 * cos)),
    });
  }
  // Close the loop for projection continuity.
  out.push({ ...out[0] });
  return out;
}

/** Thunderhill Raceway — East (~2.866 mi / 4.61 km). */
export const THUNDERHILL_EAST_CENTERLINE: LatLon[] = ellipseLoop(
  39.540333,
  -122.330694,
  620,
  780,
  96,
  0.22,
);

/**
 * Thunderhill Raceway — West (~3 mi). Centered on the West timing line;
 * elongated N–S to roughly match the West layout footprint.
 */
export const THUNDERHILL_WEST_CENTERLINE: LatLon[] = ellipseLoop(
  39.53776,
  -122.33875,
  700,
  520,
  96,
  0.2,
);

const BUILTIN: Record<string, LatLon[]> = {
  "thunderhill-east": THUNDERHILL_EAST_CENTERLINE,
  "thunderhill-west": THUNDERHILL_WEST_CENTERLINE,
  "custom-thunderhill-west": THUNDERHILL_WEST_CENTERLINE,
  "custom-thunderhill-east": THUNDERHILL_EAST_CENTERLINE,
};

export function builtinCenterline(trackId: string | null | undefined): LatLon[] | null {
  if (!trackId) return null;
  return BUILTIN[trackId] ?? null;
}
