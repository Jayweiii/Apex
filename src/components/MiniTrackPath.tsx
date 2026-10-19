"use client";

import type { TelemetryPoint } from "@/lib/types";

/** Lightweight SVG outline of a GPS lap for comparison cards. */
export function MiniTrackPath({
  points,
  color = "#f97316",
  className = "h-24 w-full",
}: {
  points: TelemetryPoint[];
  color?: string;
  className?: string;
}) {
  const gps = points.filter(
    (p): p is TelemetryPoint & { lat: number; lon: number } =>
      p.lat != null && p.lon != null,
  );
  if (gps.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-[11px] text-zinc-600 ${className}`}
      >
        No GPS
      </div>
    );
  }

  const lats = gps.map((p) => p.lat);
  const lons = gps.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const pad = 0.08;
  const dLat = Math.max(maxLat - minLat, 1e-6);
  const dLon = Math.max(maxLon - minLon, 1e-6);
  const w = 120;
  const h = 72;
  const toX = (lon: number) =>
    ((lon - minLon) / dLon) * w * (1 - 2 * pad) + w * pad;
  const toY = (lat: number) =>
    (1 - (lat - minLat) / dLat) * h * (1 - 2 * pad) + h * pad;

  const step = Math.max(1, Math.floor(gps.length / 80));
  const sampled = gps.filter((_, i) => i % step === 0 || i === gps.length - 1);
  const d = sampled
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${toX(p.lon).toFixed(1)},${toY(p.lat).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`rounded-lg border border-zinc-800/80 bg-zinc-950/60 ${className}`}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}
