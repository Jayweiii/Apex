import type { GpsQuality } from "@/lib/gps-quality";

export function GpsQualityBadge({
  quality,
  sourceKind,
}: {
  quality?: GpsQuality | null;
  sourceKind?: "csv" | "gopro" | "logger" | null;
}) {
  if (!quality && !sourceKind) return null;
  const isDedicated =
    sourceKind === "gopro" ||
    sourceKind === "logger" ||
    quality?.stream === "GPS5" ||
    quality?.stream === "GPS9" ||
    quality?.stream === "GPS" ||
    quality?.stream === "GPX" ||
    quality?.stream === "JSON" ||
    quality?.stream === "VBO" ||
    quality?.stream === "DRAGY";
  const label =
    quality?.label ??
    (sourceKind === "logger"
      ? "GPS logger"
      : isDedicated
        ? "GoPro GPS"
        : "Phone/CSV GPS");
  const tone = isDedicated
    ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
    : "border-zinc-600/50 bg-zinc-800/60 text-zinc-400";

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${tone}`}
      title={
        quality
          ? `${quality.sampleCount} samples` +
            (quality.droppedCount
              ? `, ${quality.droppedCount} dropped`
              : "")
          : undefined
      }
    >
      {label}
    </span>
  );
}
