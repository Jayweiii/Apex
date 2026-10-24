"use client";

import { BasemapToggle } from "@/components/BasemapToggle";
import { GpsModeToggle } from "@/components/GpsModeToggle";
import {
  BASEMAP_PREFS_EVENT,
  DEFAULT_BASEMAP,
  readBasemapPrefs,
  writeBasemapPrefs,
  type BasemapMode,
} from "@/lib/basemap-prefs";
import { hasGps } from "@/lib/compare";
import type { GpsDisplayMode } from "@/lib/map-match";
import {
  DEFAULT_MAP_VIEW_PREFS,
  MAP_VIEW_PREFS_EVENT,
  readMapViewPrefs,
  writeMapViewPrefs,
  type MapViewPrefs,
} from "@/lib/map-view-prefs";
import type { StartFinishLine } from "@/lib/start-finish-line";
import type { TelemetryPoint } from "@/lib/types";
import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentProps } from "react";

export type TrackTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  colorBySpeed?: boolean;
  /** Out / in / hot — partial laps get a map badge. */
  lapKind?: "out" | "in" | "hot";
  /** SF crossing for this lap (start for in/hot, end for out). */
  sfCrossing?: { lat: number; lon: number } | null;
};

type MapProps = {
  traces: TrackTrace[];
  activeProgress?: number | null;
  /** Hover preview — ghost marker only; never seeks video. */
  previewProgress?: number | null;
  onPreviewProgress?: (progress: number | null) => void;
  /** False while playback is playing — no ghost/hover tooltip preview. */
  hoverPreviewEnabled?: boolean;
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
  /** Stretch to parent height (session dashboard left column). */
  panel?: boolean;
  /** Hide POV/overview camera chrome (hero embeds). */
  hideCameraControls?: boolean;
  /** Start/finish gate overlay (see LeafletTrackMap). */
  sfLine?: StartFinishLine | null;
  sfEditing?: boolean;
  onSfEndpointMove?: (which: "a" | "b", lat: number, lon: number) => void;
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

/** Single Overview ↔ POV control (chase camera). */
function PovToggle({
  prefs,
  onChange,
  compact,
}: {
  prefs: MapViewPrefs;
  onChange: (next: MapViewPrefs) => void;
  compact?: boolean;
}) {
  return (
    <div
      className={`inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 ${
        compact ? "text-[11px]" : "text-xs"
      }`}
      role="group"
      aria-label="Map camera mode"
    >
      {(
        [
          { value: "overview" as const, label: "Overview" },
          { value: "chase" as const, label: "POV" },
        ] as const
      ).map((option) => {
        const active = prefs.mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange({ ...prefs, mode: option.value })}
            className={`cursor-pointer rounded-md px-2.5 py-1 transition ${
              active
                ? "bg-orange-500 text-black"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title={
              option.value === "overview"
                ? "North-up, fixed framing"
                : "Third-person chase: tilted, heading-up follow"
            }
          >
            {option.label}
          </button>
        );
      })}
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
  const [basemap, setBasemap] = useState<BasemapMode>(DEFAULT_BASEMAP);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readMapViewPrefs();
    const followId =
      stored.followId ||
      props.defaultFollowId ||
      props.traces[0]?.id ||
      "";
    setPrefs({ ...stored, followId });
    setBasemap(readBasemapPrefs());
    setHydrated(true);
    function onExternal(event: Event) {
      const detail = (event as CustomEvent<MapViewPrefs>).detail;
      if (detail) setPrefs(detail);
    }
    function onBasemapExternal(event: Event) {
      const detail = (event as CustomEvent<BasemapMode>).detail;
      if (detail === "street" || detail === "satellite") setBasemap(detail);
    }
    window.addEventListener(MAP_VIEW_PREFS_EVENT, onExternal);
    window.addEventListener(BASEMAP_PREFS_EVENT, onBasemapExternal);
    return () => {
      window.removeEventListener(MAP_VIEW_PREFS_EVENT, onExternal);
      window.removeEventListener(BASEMAP_PREFS_EVENT, onBasemapExternal);
    };
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

  // Prefer primary/ref lap when parent sets defaultFollowId and prefs empty.
  useEffect(() => {
    if (!hydrated || !props.defaultFollowId) return;
    if (prefs.followId && prefs.followId !== "centroid") return;
    if (!props.traces.some((t) => t.id === props.defaultFollowId)) return;
    setPrefs((prev) => {
      const next = { ...prev, followId: props.defaultFollowId! };
      writeMapViewPrefs(next);
      return next;
    });
  }, [hydrated, props.defaultFollowId, props.traces, prefs.followId]);

  function updatePrefs(next: MapViewPrefs) {
    setPrefs(next);
    writeMapViewPrefs(next);
  }

  function updateBasemap(next: BasemapMode) {
    setBasemap(next);
    writeBasemapPrefs(next);
  }

  if (!hasDrawable) return null;

  const hideChrome = Boolean(props.hideCameraControls);
  // SF gate handles only exist on Leaflet overview — keep overview while editing
  // without rewriting stored POV prefs (Cancel restores chase).
  const useChase =
    !hideChrome && prefs.mode === "chase" && !props.sfEditing;
  const compactChrome = Boolean(props.compact || props.panel);

  const povControl = hideChrome ? null : (
    <PovToggle
      prefs={prefs}
      onChange={updatePrefs}
      compact={compactChrome}
    />
  );

  const basemapControl = hideChrome ? null : (
    <BasemapToggle
      value={basemap}
      onChange={updateBasemap}
      compact={compactChrome}
    />
  );

  if (useChase) {
    const shellClass = props.panel
      ? "relative flex flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
      : props.compact
        ? "relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
        : "relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4";

    return (
      <div className={shellClass}>
        <div
          className={`flex flex-wrap items-center gap-2 ${
            props.panel || props.compact ? "mb-1.5 shrink-0" : "mb-3 gap-3"
          }`}
        >
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
          {basemapControl}
          {povControl}
        </div>
        <ChaseTrackMap
          traces={props.traces}
          activeProgress={props.activeProgress}
          previewProgress={props.previewProgress}
          onPreviewProgress={props.onPreviewProgress}
          hoverPreviewEnabled={props.hoverPreviewEnabled}
          onProgress={props.onProgress}
          prefs={prefs}
          compact={props.compact}
          panel={props.panel}
          basemap={basemap}
        />
      </div>
    );
  }

  return (
    <LeafletTrackMap
      {...(props as ComponentProps<typeof LeafletTrackMap>)}
      compact={props.compact}
      panel={props.panel}
      headerSlot={povControl}
      basemap={basemap}
      onBasemapChange={hideChrome ? undefined : updateBasemap}
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
