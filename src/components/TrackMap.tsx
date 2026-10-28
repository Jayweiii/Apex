"use client";

import { BasemapToggle } from "@/components/BasemapToggle";
import { GpsModeToggle } from "@/components/GpsModeToggle";
import { MobileMapPlayOverlay } from "@/components/MobileMapPlayOverlay";
import { SegmentedControl } from "@/components/SegmentedControl";
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
  /**
   * Shared progress sampling: `"time"` = elapsed ms from lap start (default for
   * session + compare so map shows spatial gap). `"track"` = distance align.
   */
  progressBasis?: "time" | "track";
  /** Required when progressBasis is `"time"` (lap_time_ms). */
  durationMs?: number;
  /** Full-rate progress while playing (avoids throttled React progress). */
  progressSubscribe?: (listener: (progress: number) => void) => () => void;
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
  /** Compare reference for POV/overview gap labels (defaults to first trace). */
  referenceId?: string;
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
  /**
   * Mobile map Play/Pause overlay (session + compare). Shown only below `sm`
   * so phone users can play without scrolling past video/charts.
   */
  mapPlaying?: boolean;
  onMapTogglePlay?: () => void;
  mapPlayDisabled?: boolean;
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

/** Overview | POV segmented control (chase camera). */
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
    <SegmentedControl
      value={prefs.mode}
      options={
        [
          {
            value: "overview" as const,
            label: "Overview",
            title: "North-up, fixed framing",
            dataAttrs: { "data-apex-pov-option": "overview" },
          },
          {
            value: "chase" as const,
            label: "POV",
            title: "Third-person chase: tilted, heading-up follow",
            dataAttrs: { "data-apex-pov-option": "chase" },
          },
        ] as const
      }
      onChange={(mode) => onChange({ ...prefs, mode })}
      ariaLabel="Map camera mode"
      compact={compact}
      accent
      groupProps={{
        "data-apex-pov-toggle": "1",
        "data-apex-pov-mode": prefs.mode,
      }}
    />
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

  const mapPlayOverlay =
    props.onMapTogglePlay != null ? (
      <MobileMapPlayOverlay
        playing={Boolean(props.mapPlaying)}
        onTogglePlay={props.onMapTogglePlay}
        disabled={props.mapPlayDisabled}
      />
    ) : null;

  if (useChase) {
    const shellClass = props.panel
      ? "relative flex flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
      : props.compact
        ? "relative overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
        : "relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4";

    return (
      <div className={shellClass}>
        {/*
          Stable map chrome (docs/UI_RULES.md): reserved rows so scrollbar /
          wrap never slides Street|Satellite beside Delta or Overview|POV
          (fat-finger on 393px). Basemap and POV each get their own row.
        */}
        <div
          className={`apex-map-chrome flex flex-col gap-1.5 ${
            props.panel || props.compact ? "mb-1.5 shrink-0" : "mb-3"
          }`}
          data-apex-map-chrome="1"
        >
          <div
            className="apex-map-chrome__modes flex flex-wrap items-center gap-2"
            data-apex-map-chrome-modes="1"
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
          </div>
          {basemapControl ? (
            <div
              className="apex-map-chrome__basemap flex items-center gap-2"
              data-apex-map-chrome-basemap="1"
            >
              {basemapControl}
            </div>
          ) : null}
          {povControl ? (
            <div
              className="apex-map-chrome__pov flex flex-wrap items-center gap-2"
              data-apex-map-chrome-pov="1"
            >
              {povControl}
            </div>
          ) : null}
        </div>
        <div className="relative min-h-0 flex-1">
          <ChaseTrackMap
            traces={props.traces}
            activeProgress={props.activeProgress}
            progressBasis={props.progressBasis}
            durationMs={props.durationMs}
            progressSubscribe={props.progressSubscribe}
            previewProgress={props.previewProgress}
            onPreviewProgress={props.onPreviewProgress}
            hoverPreviewEnabled={props.hoverPreviewEnabled}
            onProgress={props.onProgress}
            prefs={prefs}
            compact={props.compact}
            panel={props.panel}
            basemap={basemap}
            referenceId={props.referenceId ?? props.defaultFollowId}
          />
          {mapPlayOverlay}
        </div>
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
      progressBasis={props.progressBasis}
      durationMs={props.durationMs}
      progressSubscribe={props.progressSubscribe}
      mapPlayOverlay={mapPlayOverlay}
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
