/**
 * GPS quality summary for a session (GoPro GPMF, logger exports, or phone CSV).
 * Used to prefer GoPro / dedicated loggers over phone CSV in compare.
 */

export type GpsFixType = 0 | 2 | 3 | "unknown";

export type GpsQuality = {
  /** Best stream used for the session. */
  stream:
    | "GPS5"
    | "GPS9"
    | "GPS"
    | "GPX"
    | "JSON"
    | "CSV"
    | "VBO"
    | "DRAGY"
    | "unknown";
  /** Source device/app preference rank — higher is better. */
  rank: number;
  sampleCount: number;
  droppedCount: number;
  /** Dilution of precision × 100 when available (lower is better). */
  precisionP100?: number | null;
  /** 0 none, 2 2D, 3 3D. */
  fix?: GpsFixType | null;
  /** Average satellite count when available (Dragy/VBO sats column). */
  satellites?: number | null;
  /** Human label for UI. */
  label: string;
};

export type GpsSourceKind = "csv" | "gopro" | "logger" | null | undefined;

/** Rank: GoPro GPMF > dedicated logger (VBO/Dragy/GPX) > Quik JSON > phone CSV. */
export function gpsSourceRank(
  stream: GpsQuality["stream"],
  sourceKind?: GpsSourceKind,
): number {
  if (stream === "GPS9") return 100;
  if (stream === "GPS5" || stream === "GPS") return 90;
  if (stream === "VBO") return 78;
  if (stream === "DRAGY") return 76;
  if (stream === "GPX") return 74;
  if (sourceKind === "gopro") return 80;
  if (sourceKind === "logger") return 72;
  if (stream === "JSON") return 70;
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
  satellites?: number | null;
  sourceKind?: GpsSourceKind;
}): GpsQuality {
  const precisionP100 = input.precisionP100 ?? null;
  const fix = input.fix ?? null;
  const satellites =
    input.satellites != null && Number.isFinite(input.satellites)
      ? Math.round(input.satellites)
      : null;
  const rank = gpsSourceRank(input.stream, input.sourceKind);
  const parts: string[] = [];
  if (input.stream === "GPS9" || input.stream === "GPS5" || input.stream === "GPS") {
    parts.push(`GoPro ${input.stream}`);
  } else if (input.stream === "VBO") {
    parts.push("VBO (RaceLogic/Dragy)");
  } else if (input.stream === "DRAGY") {
    parts.push("Dragy CSV");
  } else if (input.stream === "GPX") {
    parts.push(
      input.sourceKind === "gopro" ? "GoPro export (GPX)" : "GPX logger",
    );
  } else if (input.stream === "JSON") {
    parts.push("GoPro export (JSON)");
  } else if (input.sourceKind === "gopro") {
    parts.push("GoPro");
  } else if (input.sourceKind === "logger") {
    parts.push("GPS logger");
  } else {
    parts.push(input.stream === "CSV" ? "Phone/CSV" : "GPS");
  }
  if (fix === 3) parts.push("3D fix");
  else if (fix === 2) parts.push("2D fix");
  else if (fix === 0) parts.push("no fix");
  if (satellites != null) parts.push(`${satellites} sats`);
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
    satellites,
    label: parts.join(" · "),
  };
}

/** Prefer the higher-ranked GPS source (GoPro / logger over phone). */
export function preferGpsSession<
  T extends { gpsQuality?: GpsQuality | null; sourceKind?: string | null },
>(a: T, b: T): number {
  const kind = (value: string | null | undefined): GpsSourceKind => {
    if (value === "gopro" || value === "logger" || value === "csv") return value;
    return null;
  };
  const rankA =
    a.gpsQuality?.rank ?? gpsSourceRank("unknown", kind(a.sourceKind));
  const rankB =
    b.gpsQuality?.rank ?? gpsSourceRank("unknown", kind(b.sourceKind));
  return rankB - rankA;
}
