import type { GpsQuality } from "@/lib/gps-quality";

export function GpsQualityBadge({
  quality,
  sourceKind,
}: {
  quality?: GpsQuality | null;
  sourceKind?: "csv" | "gopro" | null;
}) {
  if (!quality && !sourceKind) return null;
  const isGoPro =
    sourceKind === "gopro" ||
    quality?.stream === "GPS5" ||
    quality?.stream === "GPS9" ||
    quality?.stream === "GPS" ||
    quality?.stream === "GPX" ||
    quality?.stream === "JSON";
  const label = quality?.label ?? (isGoPro ? "GoPro GPS" : "Phone/CSV GPS");
  const tone = isGoPro
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
