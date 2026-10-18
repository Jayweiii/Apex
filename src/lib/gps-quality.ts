/**
 * GPS quality summary for a session (GoPro GPMF or exported telemetry).
 * Used to prefer GoPro over phone CSV in compare and show a quality badge.
 */

export type GpsFixType = 0 | 2 | 3 | "unknown";

export type GpsQuality = {
  /** Best stream used for the session. */
  stream: "GPS5" | "GPS9" | "GPS" | "GPX" | "JSON" | "CSV" | "unknown";
  /** Source device/app preference rank — higher is better. */
  rank: number;
  sampleCount: number;
  droppedCount: number;
  /** Dilution of precision × 100 when available (lower is better). */
  precisionP100?: number | null;
  /** 0 none, 2 2D, 3 3D. */
  fix?: GpsFixType | null;
  /** Human label for UI. */
  label: string;
};

/** Rank: GoPro GPMF > Quik/export > phone CSV. */
export function gpsSourceRank(
  stream: GpsQuality["stream"],
  sourceKind?: "csv" | "gopro" | null,
): number {
  if (stream === "GPS9") return 100;
  if (stream === "GPS5" || stream === "GPS") return 90;
  if (stream === "GPX" || stream === "JSON") return 70;
  if (sourceKind === "gopro") return 80;
  if (stream === "CSV") return 40;
  if (sourceKind === "csv") return 30;
  return 10;
}

export function buildGpsQuality(input: {
  stream: GpsQuality["stream"];
  sampleCount: number;
  droppedCount?: number;
  precisionP100?: number | null;
  fix?: GpsFixType | null;
  sourceKind?: "csv" | "gopro" | null;
}): GpsQuality {
  const precisionP100 = input.precisionP100 ?? null;
  const fix = input.fix ?? null;
  const rank = gpsSourceRank(input.stream, input.sourceKind);
  const parts: string[] = [];
  if (input.stream === "GPS9" || input.stream === "GPS5" || input.stream === "GPS") {
    parts.push(`GoPro ${input.stream}`);
  } else if (input.stream === "GPX" || input.stream === "JSON") {
    parts.push(`GoPro export (${input.stream})`);
  } else if (input.sourceKind === "gopro") {
    parts.push("GoPro");
  } else {
    parts.push(input.stream === "CSV" ? "Phone/CSV" : "GPS");
  }
  if (fix === 3) parts.push("3D fix");
  else if (fix === 2) parts.push("2D fix");
  else if (fix === 0) parts.push("no fix");
  if (precisionP100 != null && Number.isFinite(precisionP100)) {
    parts.push(`DOP ${(precisionP100 / 100).toFixed(1)}`);
  }
  return {
    stream: input.stream,
    rank,
    sampleCount: input.sampleCount,
    droppedCount: input.droppedCount ?? 0,
    precisionP100,
    fix,
    label: parts.join(" · "),
  };
}

/** Prefer the higher-ranked GPS source (GoPro over phone). */
export function preferGpsSession<T extends { gpsQuality?: GpsQuality | null; sourceKind?: string | null }>(
  a: T,
  b: T,
): number {
  const rankA =
    a.gpsQuality?.rank ??
    gpsSourceRank("unknown", a.sourceKind === "gopro" ? "gopro" : "csv");
  const rankB =
    b.gpsQuality?.rank ??
    gpsSourceRank("unknown", b.sourceKind === "gopro" ? "gopro" : "csv");
  return rankB - rankA;
}
