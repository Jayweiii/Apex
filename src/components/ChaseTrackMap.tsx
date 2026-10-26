"use client";

import {
  DEFAULT_BASEMAP,
  ESRI_IMAGERY,
  OSM_STREET,
  type BasemapMode,
} from "@/lib/basemap-prefs";
import { formatGap } from "@/lib/format";
import { MAP_EMBED_HEIGHT_CLASS } from "@/lib/map-height";
import {
  clampChaseZoom,
  POV_DEFAULT_ZOOM,
  POV_PITCH_DEG,
  type MapViewPrefs,
} from "@/lib/map-view-prefs";
import {
  progressNearPoint,
  sampleAtProgress,
  type GpsPoint,
} from "@/lib/scrub";
import {
  bearingAtProgress,
  centroidLatLon,
  smoothBearingAtProgress,
} from "@/lib/track-bearing";
import type { TelemetryPoint } from "@/lib/types";
import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export type ChaseTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  /** Out / in / hot — partial laps get a map badge. */
  lapKind?: "out" | "in" | "hot";
  /** SF crossing for this lap (start for in/hot, end for out). */
  sfCrossing?: { lat: number; lon: number } | null;
};

/** Dual basemap layers — swap via opacity only (no setStyle / removeSource). */
const SAT_SOURCE_ID = "basemap-satellite";
const STREET_SOURCE_ID = "basemap-street";
const SAT_LAYER_ID = "basemap-satellite";
const STREET_LAYER_ID = "basemap-street";

/** Slightly above chase pitch so 60° is never clamped against maxPitch. */
const CHASE_MAX_PITCH = 85;

function basemapStyleSources() {
  return {
    [SAT_SOURCE_ID]: {
      type: "raster" as const,
      tiles: [ESRI_IMAGERY.url],
      tileSize: 256,
      attribution: ESRI_IMAGERY.attribution,
    },
    [STREET_SOURCE_ID]: {
      type: "raster" as const,
      tiles: [OSM_STREET.maplibreUrl],
      tileSize: 256,
      attribution: OSM_STREET.attribution,
    },
  };
}

function basemapStyleLayers(mode: BasemapMode) {
  // Street under satellite: both stay loaded so Street↔Satellite is instant.
  return [
    {
      id: STREET_LAYER_ID,
      type: "raster" as const,
      source: STREET_SOURCE_ID,
      minzoom: 0,
      maxzoom: 19,
      paint: { "raster-opacity": mode === "street" ? 1 : 0 },
    },
    {
      id: SAT_LAYER_ID,
      type: "raster" as const,
      source: SAT_SOURCE_ID,
      minzoom: 0,
      maxzoom: 19,
      paint: { "raster-opacity": mode === "satellite" ? 1 : 0 },
    },
  ];
}

/**
 * Toggle Street ↔ Satellite via raster-opacity only.
 * Camera (center/zoom/bearing/pitch), GeoJSON laps, and HTML markers stay put —
 * no setStyle() and no source remove/add (avoids pitch resets + blank-tile lag).
 */
function applyBasemapTiles(
  map: MapLibreMap,
  mode: BasemapMode,
  pitch = POV_PITCH_DEG,
) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  const bearing = map.getBearing();

  if (map.getLayer(STREET_LAYER_ID) && map.getLayer(SAT_LAYER_ID)) {
    map.setPaintProperty(
      STREET_LAYER_ID,
      "raster-opacity",
      mode === "street" ? 1 : 0,
    );
    map.setPaintProperty(
      SAT_LAYER_ID,
      "raster-opacity",
      mode === "satellite" ? 1 : 0,
    );
  }

  // Always re-assert chase pitch (don't trust a stale 0 after style churn).
  map.jumpTo({ center, zoom, bearing, pitch });
}

/** Publish camera on the host for Playwright / QA. */
function syncCameraAttrs(
  host: HTMLElement | null,
  map: MapLibreMap | null,
  basemap?: BasemapMode,
) {
  if (!host || !map) return;
  try {
    host.dataset.apexPitch = String(Math.round(map.getPitch() * 10) / 10);
    host.dataset.apexZoom = String(Math.round(map.getZoom() * 100) / 100);
    host.dataset.apexBearing = String(Math.round(map.getBearing() * 10) / 10);
    if (basemap) host.dataset.apexBasemap = basemap;
  } catch {
    // Map may be mid-remove during unmount.
  }
}

export { POV_DEFAULT_ZOOM, POV_PITCH_DEG };

const MARKER_SHAPES = ["ring", "filled", "square", "diamond"] as const;

const MAP_HEIGHT = {
  default: "h-[65vh] min-h-[320px] sm:min-h-[420px]",
  /** Home / directory embeds — intentionally shorter. */
  compact: "h-[220px] min-h-[180px] sm:h-[280px]",
  /** Session + compare workspace — explicit vh/vw, never flex-collapse. */
  panel: MAP_EMBED_HEIGHT_CLASS,
} as const;

function toGps(points: TelemetryPoint[]): GpsPoint[] {
  return points.filter(
    (point): point is GpsPoint => point.lat != null && point.lon != null,
  );
}

function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function markerHtml(
  color: string,
  shape: (typeof MARKER_SHAPES)[number],
  ghost: boolean,
) {
  const base =
    shape === "ring"
      ? "apex-car-marker__dot apex-car-marker__dot--ring apex-car-marker__dot--chase"
      : shape === "square"
        ? "apex-car-marker__dot apex-car-marker__dot--square apex-car-marker__dot--chase"
        : shape === "diamond"
          ? "apex-car-marker__dot apex-car-marker__dot--diamond apex-car-marker__dot--chase"
          : "apex-car-marker__dot apex-car-marker__dot--chase";
  const cls = ghost ? `${base} apex-car-marker__dot--ghost` : base;
  return `<div class="apex-car-marker"><div class="${cls}" style="--apex-car:${color}"></div></div>`;
}

function gapHtml(label: string) {
  return `<div class="apex-car-marker"><span class="apex-car-marker__gap">${label}</span></div>`;
}

function sfCrossingHtml() {
  return `<div class="apex-sf-crossing"><div class="apex-sf-crossing__dot" title="SF crossing"></div><span class="apex-sf-crossing__label">SF</span></div>`;
}

function lapKindHtml(kind: "out" | "in") {
  const label = kind === "out" ? "OUT" : "IN";
  return `<div class="apex-lap-kind"><span class="apex-lap-kind__badge apex-lap-kind__badge--${kind}">${label}</span></div>`;
}

/**
 * POV / third-person chase camera (MapLibre + free Esri/OSM raster).
 * Centers on follow lap, pitch ~60°, bearing = smoothed travel heading.
 */
export function ChaseTrackMap({
  traces,
  activeProgress,
  previewProgress = null,
  onPreviewProgress,
  hoverPreviewEnabled = true,
  onProgress,
  prefs,
  pitch = POV_PITCH_DEG,
  compact = false,
  panel = false,
  basemap = DEFAULT_BASEMAP,
  progressBasis = "track",
  durationMs,
  progressSubscribe,
}: {
  traces: ChaseTrace[];
  activeProgress?: number | null;
  /** Chart hover preview — markers/camera without seeking video. */
  previewProgress?: number | null;
  onPreviewProgress?: (progress: number | null) => void;
  /** False while playback is playing — no ghost/hover preview. */
  hoverPreviewEnabled?: boolean;
  onProgress?: (progress: number | null) => void;
  prefs: MapViewPrefs;
  pitch?: number;
  compact?: boolean;
  panel?: boolean;
  /** Shared Street | Satellite selection (persists across Overview/POV). */
  basemap?: BasemapMode;
  /** `"time"` = session shared clock; `"track"` = compare distance align. */
  progressBasis?: "time" | "track";
  durationMs?: number;
  /** Full-rate progress while playing (map markers / chase camera). */
  progressSubscribe?: (listener: (progress: number) => void) => () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const annotMarkersRef = useRef<Marker[]>([]);
  const bearingRef = useRef<number | null>(null);
  const onProgressRef = useRef(onProgress);
  const onPreviewProgressRef = useRef(onPreviewProgress);
  const hoverPreviewEnabledRef = useRef(hoverPreviewEnabled);
  onProgressRef.current = onProgress;
  onPreviewProgressRef.current = onPreviewProgress;
  hoverPreviewEnabledRef.current = hoverPreviewEnabled;

  useEffect(() => {
    if (hoverPreviewEnabled) return;
    onPreviewProgressRef.current?.(null);
  }, [hoverPreviewEnabled]);

  const drawable = useMemo(
    () =>
      traces
        .map((trace) => ({ ...trace, points: toGps(trace.points) }))
        .filter((trace) => trace.points.length > 1),
    [traces],
  );
  const drawableRef = useRef(drawable);
  drawableRef.current = drawable;
  const sampleOpts = useMemo(
    () =>
      progressBasis === "time"
        ? {
            basis: "time" as const,
            durationSec:
              durationMs != null && durationMs > 0
                ? durationMs / 1000
                : undefined,
          }
        : undefined,
    [progressBasis, durationMs],
  );
  const sampleOptsRef = useRef(sampleOpts);
  sampleOptsRef.current = sampleOpts;
  const appliedBasemapRef = useRef<BasemapMode | null>(null);
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  // Create map once (both basemaps; later swaps via opacity only).
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: {
        version: 8,
        sources: basemapStyleSources(),
        layers: basemapStyleLayers(basemap),
      },
      center: [-122.33, 39.54],
      zoom: clampChaseZoom(prefs.chaseZoom || POV_DEFAULT_ZOOM),
      pitch,
      maxPitch: CHASE_MAX_PITCH,
      bearing: 0,
      attributionControl: { compact: true },
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      map.resize();
      // Sky/horizon makes chase pitch obvious on flat OSM cartography.
      try {
        map.setSky({
          "sky-color": "#0b1220",
          "horizon-color": "#1e293b",
          "fog-color": "#0b1220",
          "sky-horizon-blend": 0.35,
          "horizon-fog-blend": 0.75,
          "fog-ground-blend": 0,
        });
      } catch {
        // Older style parsers — sky is optional visual polish.
      }
      // Re-assert pitch after first tiles (guards against style init clamps).
      map.jumpTo({
        center: map.getCenter(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch,
      });
      syncCameraAttrs(hostRef.current, map, basemapRef.current);
    });
    map.on("moveend", () =>
      syncCameraAttrs(hostRef.current, map, basemapRef.current),
    );

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.resize();
          })
        : null;
    if (ro && hostRef.current) ro.observe(hostRef.current);

    const progressAt = (clientX: number, clientY: number) => {
      const current = drawableRef.current;
      if (!current.length) return null;
      const rect = map.getContainer().getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const lngLat = map.unproject([x, y]);
      let best = { progress: 0, distance: Number.POSITIVE_INFINITY };
      for (const trace of current) {
        const candidate = progressNearPoint(
          trace.points,
          lngLat.lat,
          lngLat.lng,
          haversine,
          sampleOptsRef.current,
        );
        if (candidate.distance < best.distance) best = candidate;
      }
      return best.progress;
    };

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const progress = progressAt(
        event.originalEvent.clientX,
        event.originalEvent.clientY,
      );
      if (progress == null) return;
      onPreviewProgressRef.current?.(null);
      onProgressRef.current?.(progress);
    };
    const onMove = (event: maplibregl.MapMouseEvent) => {
      const progress = progressAt(
        event.originalEvent.clientX,
        event.originalEvent.clientY,
      );
      if (progress == null) return;
      if (event.originalEvent.buttons === 1) {
        onPreviewProgressRef.current?.(null);
        onProgressRef.current?.(progress);
        return;
      }
      // While playing, hover preview is disabled; drag-seek still works above.
      if (!hoverPreviewEnabledRef.current) return;
      onPreviewProgressRef.current?.(progress);
    };
    const onLeave = () => {
      onPreviewProgressRef.current?.(null);
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    const container = map.getContainer();
    container.addEventListener("mouseleave", onLeave);
    container.style.cursor = "pointer";

    return () => {
      ro?.disconnect();
      container.removeEventListener("mouseleave", onLeave);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      annotMarkersRef.current.forEach((marker) => marker.remove());
      annotMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
  }, []);

  // Swap Street ↔ Satellite via opacity (keeps chase camera + lap layers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Initial style already has the correct opacities; skip no-op remount churn.
    if (appliedBasemapRef.current == null) {
      appliedBasemapRef.current = basemap;
      return;
    }
    if (appliedBasemapRef.current === basemap) return;
    const swap = () => {
      applyBasemapTiles(map, basemap, pitch);
      appliedBasemapRef.current = basemap;
      syncCameraAttrs(hostRef.current, map, basemap);
    };
    if (map.isStyleLoaded()) swap();
    else map.once("load", swap);
  }, [basemap, pitch]);

  // SF crossing + out/in tags (additive; north-up + POV).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const place = () => {
      annotMarkersRef.current.forEach((marker) => marker.remove());
      annotMarkersRef.current = [];
      for (const trace of drawable) {
        const crossing = trace.sfCrossing;
        if (
          crossing &&
          Number.isFinite(crossing.lat) &&
          Number.isFinite(crossing.lon)
        ) {
          const el = document.createElement("div");
          el.innerHTML = sfCrossingHtml();
          const marker = new maplibregl.Marker({
            element: el.firstElementChild as HTMLElement,
            anchor: "center",
          })
            .setLngLat([crossing.lon, crossing.lat])
            .addTo(map);
          annotMarkersRef.current.push(marker);
        }
        if (trace.lapKind === "out" || trace.lapKind === "in") {
          const mid = trace.points[Math.floor(trace.points.length / 2)];
          if (!mid) continue;
          const el = document.createElement("div");
          el.innerHTML = lapKindHtml(trace.lapKind);
          const marker = new maplibregl.Marker({
            element: el.firstElementChild as HTMLElement,
            anchor: "bottom",
          })
            .setLngLat([mid.lon, mid.lat])
            .addTo(map);
          annotMarkersRef.current.push(marker);
        }
      }
    };

    if (map.isStyleLoaded()) place();
    else map.once("load", place);
  }, [drawable]);

  // Draw / update polylines when traces change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const followId = prefs.followId;

    const apply = () => {
      for (const layer of [...(map.getStyle().layers ?? [])]) {
        if (layer.id.startsWith("lap-line-")) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      }
      for (const key of Object.keys(map.getStyle().sources ?? {})) {
        if (key.startsWith("lap-src-")) {
          if (map.getSource(key)) map.removeSource(key);
        }
      }

      drawable.forEach((trace) => {
        const srcId = `lap-src-${trace.id}`;
        const layerId = `lap-line-${trace.id}`;
        const coords = trace.points.map(
          (point) => [point.lon, point.lat] as [number, number],
        );
        const isFollow =
          followId === "centroid" ||
          !followId ||
          trace.id === followId;
        map.addSource(srcId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: coords },
          },
        });
        map.addLayer({
          id: layerId,
          type: "line",
          source: srcId,
          paint: {
            "line-color": trace.color,
            "line-width": isFollow ? 3.5 : 2,
            "line-opacity": isFollow ? 0.95 : 0.35,
          },
        });
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [drawable, prefs.followId]);

  // Camera + markers follow progress (playback, hover preview, click seek).
  // Prefer progressSubscribe for full-rate updates while playing (no React churn).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawable.length) return;

    const place = (clockProgress: number) => {
      const progress =
        (hoverPreviewEnabled ? previewProgress : null) ?? clockProgress;
      const zoom = clampChaseZoom(prefs.chaseZoom || POV_DEFAULT_ZOOM);

      const samples = drawable.map((trace) => {
        const point = sampleAtProgress(trace.points, progress, sampleOpts);
        return {
          trace,
          point,
          lat: point.lat,
          lon: point.lon,
        };
      });

      let follow = samples[0];
      if (prefs.followId === "centroid") {
        const c = centroidLatLon(samples);
        if (c) {
          follow = {
            ...samples[0],
            lat: c.lat,
            lon: c.lon,
          };
        }
      } else if (prefs.followId) {
        follow =
          samples.find((s) => s.trace.id === prefs.followId) ?? samples[0];
      }

      const followTrace =
        drawable.find((t) => t.id === follow.trace.id) ?? drawable[0];
      const nextBearing = smoothBearingAtProgress(
        followTrace.points,
        progress,
        bearingRef.current,
        { sampleOpts },
      );
      bearingRef.current = nextBearing;

      // jumpTo every frame — no animation lag vs playback / hover seek.
      map.jumpTo({
        center: [follow.lon, follow.lat],
        zoom,
        bearing: nextBearing,
        pitch,
      });
      syncCameraAttrs(hostRef.current, map, basemapRef.current);

      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      const followId = prefs.followId;
      samples.forEach((sample, index) => {
        const isFollow =
          followId === "centroid" ||
          !followId ||
          sample.trace.id === followId ||
          sample.trace.id === follow.trace.id;
        const el = document.createElement("div");
        el.innerHTML = markerHtml(
          sample.trace.color,
          MARKER_SHAPES[index % MARKER_SHAPES.length] ?? "filled",
          !isFollow,
        );
        const marker = new maplibregl.Marker({
          element: el.firstElementChild as HTMLElement,
          anchor: "center",
        })
          .setLngLat([sample.lon, sample.lat])
          .addTo(map);
        markersRef.current.push(marker);
      });

      if (samples.length >= 2 && prefs.followId !== "centroid") {
        const ref =
          samples.find((s) => s.trace.id === follow.trace.id) ?? samples[0];
        for (const other of samples) {
          if (other.trace.id === ref.trace.id) continue;
          const gapSec = other.point.t - ref.point.t;
          if (!Number.isFinite(gapSec) || Math.abs(gapSec) >= 30) continue;
          const el = document.createElement("div");
          el.innerHTML = gapHtml(formatGap(gapSec));
          const marker = new maplibregl.Marker({
            element: el.firstElementChild as HTMLElement,
            anchor: "left",
            offset: [10, 0],
          })
            .setLngLat([other.lon, other.lat])
            .addTo(map);
          markersRef.current.push(marker);
        }
      }

      if (prefs.followId === "centroid" && samples.length > 1) {
        const bounds = new maplibregl.LngLatBounds();
        samples.forEach((s) => bounds.extend([s.lon, s.lat]));
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, {
            padding: 80,
            maxZoom: zoom,
            duration: 0,
            bearing: nextBearing,
            pitch,
          });
        }
      }
    };

    if (progressSubscribe && !previewProgress) {
      return progressSubscribe((p) => place(p));
    }
    place(activeProgress ?? 0);
  }, [
    activeProgress,
    previewProgress,
    hoverPreviewEnabled,
    drawable,
    prefs.chaseZoom,
    prefs.followId,
    pitch,
    sampleOpts,
    progressSubscribe,
  ]);

  void bearingAtProgress;

  const heightClass = panel
    ? MAP_HEIGHT.panel
    : compact
      ? MAP_HEIGHT.compact
      : MAP_HEIGHT.default;

  return (
    <div
      ref={hostRef}
      className={`${heightClass} w-full touch-none overflow-hidden rounded-xl cursor-pointer [&_.maplibregl-canvas]:cursor-pointer [&_.maplibregl-ctrl-attrib]:bg-zinc-950/80 [&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib]:text-zinc-400`}
      data-apex-map="chase"
      data-apex-pov="1"
      data-apex-map-hover={hoverPreviewEnabled ? "1" : "0"}
    />
  );
}

export default ChaseTrackMap;
