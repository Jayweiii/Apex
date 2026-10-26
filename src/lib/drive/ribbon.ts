import type { DrivePoint } from "@/lib/drive/types";

export type RibbonHit = {
  onTrack: boolean;
  /** Signed lateral offset from centerline (m). */
  lateral: number;
  /** Distance along track from first point (m). */
  along: number;
  /** Closest centerline point index (segment start). */
  segIndex: number;
  /** Heading of the nearest segment (rad, 0=north). */
  pathHeading: number;
};

/**
 * Project a point onto the polyline; return lateral distance + along-track.
 * O(n) — fine for ~200–400 ribbon samples at 60fps.
 */
export function projectOnRibbon(
  centerline: DrivePoint[],
  x: number,
  y: number,
): RibbonHit {
  if (centerline.length < 2) {
    return {
      onTrack: false,
      lateral: 0,
      along: 0,
      segIndex: 0,
      pathHeading: 0,
    };
  }

  let bestDist = Infinity;
  let bestLat = 0;
  let bestAlong = 0;
  let bestSeg = 0;
  let bestHx = 0;
  let bestHy = 1;
  let traveled = 0;

  for (let i = 0; i < centerline.length - 1; i += 1) {
    const a = centerline[i]!;
    const b = centerline[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2),
    );
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (dist < bestDist) {
      bestDist = dist;
      // Signed lateral: cross(path, toPoint)
      const len = Math.sqrt(len2);
      bestLat = (dx * (y - a.y) - dy * (x - a.x)) / len;
      bestAlong = traveled + t * len;
      bestSeg = i;
      bestHx = dx / len;
      bestHy = dy / len;
    }
    traveled += Math.sqrt(len2);
  }

  return {
    onTrack: false, // caller sets with halfWidth
    lateral: bestLat,
    along: bestAlong,
    segIndex: bestSeg,
    pathHeading: Math.atan2(bestHx, bestHy),
  };
}

export function isOnTrack(hit: RibbonHit, halfWidthM: number): boolean {
  return Math.abs(hit.lateral) <= halfWidthM;
}

/** Build left/right edge polylines for drawing the asphalt ribbon. */
export function ribbonEdges(
  centerline: DrivePoint[],
  halfWidthM: number,
): { left: DrivePoint[]; right: DrivePoint[] } {
  const left: DrivePoint[] = [];
  const right: DrivePoint[] = [];
  for (let i = 0; i < centerline.length; i += 1) {
    const prev = centerline[Math.max(0, i - 1)]!;
    const next = centerline[Math.min(centerline.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular (rotate path 90° CCW in east/north → left of travel).
    const nx = -dy / len;
    const ny = dx / len;
    const p = centerline[i]!;
    left.push({ x: p.x + nx * halfWidthM, y: p.y + ny * halfWidthM });
    right.push({ x: p.x - nx * halfWidthM, y: p.y - ny * halfWidthM });
  }
  return { left, right };
}
