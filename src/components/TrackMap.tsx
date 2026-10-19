"use client";

import { GpsModeToggle } from "@/components/GpsModeToggle";
import { hasGps } from "@/lib/compare";
import type { GpsDisplayMode } from "@/lib/map-match";
import {
  clampChaseZoom,
  DEFAULT_MAP_VIEW_PREFS,
  MAP_VIEW_PREFS_EVENT,
  readMapViewPrefs,
  writeMapViewPrefs,
  type MapViewPrefs,
} from "@/lib/map-view-prefs";
import type { TelemetryPoint } from "@/lib/types";
import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentProps } from "react";

export type TrackTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  colorBySpeed?: boolean;
};

type MapProps = {
  traces: TrackTrace[];
  activeProgress?: number | null;
  onProgress?: (progress: number | null) => void;
  gpsMode?: GpsDisplayMode;
  onGpsModeChange?: (mode: GpsDisplayMode) => void;
  analysisMode?: GpsDisplayMode;
  onAnalysisModeChange?: (mode: GpsDisplayMode) => void;
  analysisDisabled?: boolean;
  centerline?: Array<{ lat: number; lon: number }> | null;
  /** Prefer this trace as chase follow default (e.g. reference lap). */
  defaultFollowId?: string;
  /** Shorter map for home/hero embeds. */
  compact?: boolean;
  /** Hide chase/overview camera chrome (hero embeds). */
  hideCameraControls?: boolean;
};

const mapLoading = (
  <div className="flex h-[65vh] min-h-[320px] items-center justify-center rounded-xl border border-dashed border-zinc-800 text-sm text-zinc-500 sm:min-h-[420px]">
    Loading satellite map…
  </div>
);

const LeafletTrackMap = dynamic(
  () => import("@/components/LeafletTrackMap"),
  { ssr: false, loading: () => mapLoading },
);

const ChaseTrackMap = dynamic(
  () => import("@/components/ChaseTrackMap"),
  { ssr: false, loading: () => mapLoading },
);

function CameraControls({
  prefs,
  traces,
  onChange,
}: {
  prefs: MapViewPrefs;
  traces: TrackTrace[];
  onChange: (next: MapViewPrefs) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
      <div
        className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs"
        role="group"
        aria-label="Map camera mode"
      >
        {(
          [
            { value: "overview" as const, label: "Overview" },
            { value: "chase" as const, label: "Chase" },
          ] as const
        ).map((option) => {
          const active = prefs.mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange({ ...prefs, mode: option.value })}
              className={`rounded-md px-2.5 py-1 transition ${
                active
                  ? "bg-orange-500 text-black"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
              title={
                option.value === "overview"
                  ? "North-up, fixed framing"
                  : "Zoomed, heading-up follow"
              }
            >
              {option.label}
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                {option.value === "overview" ? "· north-up" : "· heading-up"}
              </span>
            </button>
          );
        })}
      </div>

      {prefs.mode === "chase" ? (
        <>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="uppercase tracking-[0.14em] text-zinc-500">
              Follow
            </span>
            <select
              value={prefs.followId || traces[0]?.id || ""}
              onChange={(event) =>
                onChange({ ...prefs, followId: event.target.value })
              }
              className="min-h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-xs text-zinc-200"
            >
              {traces.map((trace) => (
                <option key={trace.id} value={trace.id}>
                  {trace.label}
                </option>
              ))}
              {traces.length > 1 ? (
                <option value="centroid">All (centroid)</option>
              ) : null}
            </select>
          </label>
          <label className="flex min-w-[140px] flex-1 items-center gap-2 text-xs text-zinc-400 sm:max-w-[220px]">
            <span className="uppercase tracking-[0.14em] text-zinc-500">
              Zoom
            </span>
            <input
              type="range"
              min={16}
              max={19}
              step={0.5}
              value={prefs.chaseZoom}
              onChange={(event) =>
                onChange({
                  ...prefs,
                  chaseZoom: clampChaseZoom(Number(event.target.value)),
                })
              }
              className="w-full accent-orange-500"
            />
            <span className="font-mono text-zinc-300">
              {prefs.chaseZoom.toFixed(1)}
            </span>
          </label>
        </>
      ) : null}
    </div>
  );
}

export function TrackMap(props: MapProps) {
  const hasDrawable = props.traces.some(
    (trace) =>
      trace.points.filter((point) => point.lat != null && point.lon != null)
        .length > 1,
  );

  const [prefs, setPrefs] = useState<MapViewPrefs>(() => ({
    ...DEFAULT_MAP_VIEW_PREFS,
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readMapViewPrefs();
    const followId =
      stored.followId ||
      props.defaultFollowId ||
      props.traces[0]?.id ||
      "";
    setPrefs({ ...stored, followId });
    setHydrated(true);
    function onExternal(event: Event) {
      const detail = (event as CustomEvent<MapViewPrefs>).detail;
      if (detail) setPrefs(detail);
    }
    window.addEventListener(MAP_VIEW_PREFS_EVENT, onExternal);
    return () => window.removeEventListener(MAP_VIEW_PREFS_EVENT, onExternal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const followId = prefs.followId;
    if (
      followId &&
      followId !== "centroid" &&
      !props.traces.some((t) => t.id === followId)
    ) {
      const nextFollow =
        props.defaultFollowId || props.traces[0]?.id || "";
      if (nextFollow === followId) return;
      setPrefs((prev) => {
        const next = { ...prev, followId: nextFollow };
        writeMapViewPrefs(next);
        return next;
      });
    }
  }, [props.traces, props.defaultFollowId, prefs.followId, hydrated]);

  function updatePrefs(next: MapViewPrefs) {
    setPrefs(next);
    writeMapViewPrefs(next);
  }

  if (!hasDrawable) return null;

  const hideChrome = Boolean(props.hideCameraControls || props.compact);
  const useChase = !hideChrome && prefs.mode === "chase";

  if (useChase) {
    return (
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {props.gpsMode && props.onGpsModeChange ? (
            <GpsModeToggle
              mode={props.gpsMode}
              onChange={props.onGpsModeChange}
              label="Map"
              ariaLabel="Map GPS display mode"
            />
          ) : (
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              Map
            </p>
          )}
          {props.analysisMode && props.onAnalysisModeChange ? (
            <GpsModeToggle
              mode={props.analysisMode}
              onChange={props.onAnalysisModeChange}
              label="Delta"
              ariaLabel="Delta calculation mode"
              disabled={props.analysisDisabled}
            />
          ) : null}
        </div>
        <CameraControls
          prefs={prefs}
          traces={props.traces}
          onChange={updatePrefs}
        />
        <ChaseTrackMap
          traces={props.traces}
          activeProgress={props.activeProgress}
          onProgress={props.onProgress}
          prefs={prefs}
        />
      </div>
    );
  }

  return (
    <LeafletTrackMap
      {...(props as ComponentProps<typeof LeafletTrackMap>)}
      compact={props.compact}
      headerSlot={
        hideChrome ? null : (
          <CameraControls
            prefs={prefs}
            traces={props.traces}
            onChange={updatePrefs}
          />
        )
      }
    />
  );
}

export function lapHasGps(points: TelemetryPoint[]) {
  return hasGps(points);
}

export function MissingGps() {
  return (
    <p className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-400">
      No GPS in this file. It needs latitude and longitude columns named{" "}
      <span className="text-zinc-200">lat</span> and{" "}
      <span className="text-zinc-200">lon</span>.
    </p>
  );
}
