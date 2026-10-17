"use client";

import { hasGps } from "@/lib/compare";
import type { GpsDisplayMode } from "@/lib/map-match";
import type { TelemetryPoint } from "@/lib/types";
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

export type TrackTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  colorBySpeed?: boolean;
};

type LeafletProps = {
  traces: TrackTrace[];
  activeProgress?: number | null;
  onProgress?: (progress: number | null) => void;
  gpsMode?: GpsDisplayMode;
  onGpsModeChange?: (mode: GpsDisplayMode) => void;
  /** Independent Raw/Snapped mode for delta / corners / charts. */
  analysisMode?: GpsDisplayMode;
  onAnalysisModeChange?: (mode: GpsDisplayMode) => void;
  analysisDisabled?: boolean;
  centerline?: Array<{ lat: number; lon: number }> | null;
};

/** Leaflet + Esri imagery must stay client-only (window/DOM). */
const LeafletTrackMap = dynamic(
  () => import("@/components/LeafletTrackMap"),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <p className="mb-3 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
          Map
        </p>
        <div className="flex h-[260px] items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500 sm:h-[380px]">
          Loading satellite map…
        </div>
      </div>
    ),
  },
);

export function TrackMap(props: LeafletProps) {
  const hasDrawable = props.traces.some(
    (trace) =>
      trace.points.filter((point) => point.lat != null && point.lon != null)
        .length > 1,
  );
  if (!hasDrawable) return null;
  return <LeafletTrackMap {...(props as ComponentProps<typeof LeafletTrackMap>)} />;
}

export function lapHasGps(points: TelemetryPoint[]) {
  return hasGps(points);
}

export function MissingGps() {
  return (
    <p className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-400">
      No GPS in this file. It needs latitude and longitude columns named{" "}
      <span className="text-zinc-200">lat</span> and{" "}
      <span className="text-zinc-200">lon</span>. Load the sample session to see a
      track.
    </p>
  );
}
