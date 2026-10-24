"use client";

import { BasemapToggle } from "@/components/BasemapToggle";
import { GpsModeToggle } from "@/components/GpsModeToggle";
import { useSpeedUnit } from "@/components/useSpeedUnit";
import {
  DEFAULT_BASEMAP,
  ESRI_IMAGERY,
  OSM_STREET,
  type BasemapMode,
} from "@/lib/basemap-prefs";
import { formatG, formatGap, formatSpeed } from "@/lib/format";
import { MAP_EMBED_HEIGHT_CLASS } from "@/lib/map-height";
import type { GpsDisplayMode } from "@/lib/map-match";
import {
  progressNearPoint,
  sampleAtProgress,
  type GpsPoint,
} from "@/lib/scrub";
import {
  ensureStartFinishEndpoints,
  type StartFinishLine,
} from "@/lib/start-finish-line";
import type { TelemetryPoint } from "@/lib/types";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "leaflet/dist/leaflet.css";

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

export type { BasemapMode };

function speedColor(speed: number, min: number, max: number) {
  const t = max <= min ? 1 : Math.min(1, Math.max(0, (speed - min) / (max - min)));
  const r = Math.round(82 + (249 - 82) * t);
  const g = Math.round(82 + (115 - 82) * t);
  const b = Math.round(90 + (22 - 90) * t);
  return `rgb(${r} ${g} ${b})`;
}

function toLatLngs(points: GpsPoint[]): L.LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon] as [number, number]);
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

function nearestProgress(
  latlng: L.LatLng,
  traces: Array<TrackTrace & { points: GpsPoint[] }>,
) {
  let best = { progress: 0, distance: Number.POSITIVE_INFINITY };
  for (const trace of traces) {
    const candidate = progressNearPoint(
      trace.points,
      latlng.lat,
      latlng.lng,
      haversine,
    );
    if (candidate.distance < best.distance) best = candidate;
  }
  return best.progress;
}

function tracesKey(traces: Array<TrackTrace & { points: GpsPoint[] }>) {
  return traces
    .map((trace) => {
      const first = trace.points[0];
      const last = trace.points[trace.points.length - 1];
      return `${trace.id}:${trace.points.length}:${first?.lat?.toFixed(5)}:${last?.lat?.toFixed(5)}:${trace.colorBySpeed ? 1 : 0}`;
    })
    .join("|");
}

type CarMarkerStyle = "ring" | "filled" | "square" | "diamond";

const MARKER_STYLES: CarMarkerStyle[] = ["ring", "filled", "square", "diamond"];

/** Compact HTML car marker — distinct shapes when up to 4 overlap. */
function carMarkerIcon(
  color: string,
  style: CarMarkerStyle = "filled",
  ghost = false,
) {
  const size = style === "ring" ? 11 : 9;
  const shapeClass =
    style === "ring"
      ? "apex-car-marker__dot apex-car-marker__dot--ring"
      : style === "square"
        ? "apex-car-marker__dot apex-car-marker__dot--square"
        : style === "diamond"
          ? "apex-car-marker__dot apex-car-marker__dot--diamond"
          : "apex-car-marker__dot";
  const ghostClass = ghost ? " apex-car-marker__dot--ghost" : "";
  return L.divIcon({
    className: "apex-car-marker",
    html: `<div class="${shapeClass}${ghostClass}" style="--apex-car:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function markerStyleForIndex(index: number): CarMarkerStyle {
  return MARKER_STYLES[index % MARKER_STYLES.length] ?? "filled";
}

function gapLabelIcon(label: string) {
  return L.divIcon({
    className: "apex-car-marker",
    html: `<span class="apex-car-marker__gap">${label}</span>`,
    iconSize: [1, 1],
    iconAnchor: [-8, 10],
  });
}

/** Move lat/lon by `meters` along compass bearing (degrees). */
function offsetByBearing(
  lat: number,
  lon: number,
  bearingDeg: number,
  meters: number,
): { lat: number; lon: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const brng = toRad(bearingDeg);
  const R = 6371000;
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(meters / R) +
      Math.cos(lat1) * Math.sin(meters / R) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(meters / R) * Math.cos(lat1),
      Math.cos(meters / R) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/** Approximate along-track bearing (deg) near `progress` for a perpendicular nudge. */
function trackBearing(points: GpsPoint[], progress: number): number {
  if (points.length < 2) return 0;
  const here = sampleAtProgress(points, progress);
  const ahead = sampleAtProgress(points, Math.min(1, progress + 0.01));
  const dLat = ahead.lat - here.lat;
  const dLon = ahead.lon - here.lon;
  return (Math.atan2(dLon, dLat) * 180) / Math.PI;
}

/**
 * Fan multi-lap scrub markers perpendicular to the racing line so ring +
 * filled dots stay readable even when GPS positions coincide.
 */
function separateScrubPositions(
  samples: Array<{ lat: number; lon: number; bearing: number }>,
  baseOffsetM = 5,
): Array<{ lat: number; lon: number }> {
  if (samples.length < 2) {
    return samples.map((s) => ({ lat: s.lat, lon: s.lon }));
  }
  return samples.map((sample, index) => {
    const sign = index === 0 ? -1 : index === 1 ? 1 : index % 2 === 0 ? -1 : 1;
    const meters = baseOffsetM * (1 + Math.floor(index / 2) * 0.6);
    return offsetByBearing(
      sample.lat,
      sample.lon,
      sample.bearing + 90 * sign,
      meters,
    );
  });
}

const MAP_HEIGHT = {
  default: "h-[65vh] min-h-[320px] sm:min-h-[420px]",
  /** Home / directory embeds — intentionally shorter. */
  compact: "h-[220px] min-h-[180px] sm:h-[280px]",
  /** Session + compare workspace — explicit vh/vw, never flex-collapse. */
  panel: MAP_EMBED_HEIGHT_CLASS,
} as const;

function sfHandleIcon(label: string) {
  return L.divIcon({
    className: "apex-sf-handle",
    html: `<button type="button" class="apex-sf-handle__btn" aria-label="Start/finish ${label}">${label}</button>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function sfCrossingIcon() {
  return L.divIcon({
    className: "apex-sf-crossing",
    html: `<div class="apex-sf-crossing__dot" title="SF crossing"></div><span class="apex-sf-crossing__label">SF</span>`,
    iconSize: [28, 28],
    iconAnchor: [5, 5],
  });
}

function lapKindIcon(kind: "out" | "in") {
  const label = kind === "out" ? "OUT" : "IN";
  return L.divIcon({
    className: "apex-lap-kind",
    html: `<span class="apex-lap-kind__badge apex-lap-kind__badge--${kind}">${label}</span>`,
    iconSize: [36, 18],
    iconAnchor: [18, 22],
  });
}

export function LeafletTrackMap({
  traces,
  activeProgress = null,
  previewProgress = null,
  onPreviewProgress,
  onProgress,
  gpsMode,
  onGpsModeChange,
  analysisMode,
  onAnalysisModeChange,
  analysisDisabled = false,
  centerline,
  embedded = false,
  compact = false,
  panel = false,
  headerSlot,
  sfLine = null,
  sfEditing = false,
  onSfEndpointMove,
  basemap = DEFAULT_BASEMAP,
  onBasemapChange,
}: {
  traces: TrackTrace[];
  activeProgress?: number | null;
  /** Hover-only ghost position — never seeks video/playback. */
  previewProgress?: number | null;
  onPreviewProgress?: (progress: number | null) => void;
  onProgress?: (progress: number | null) => void;
  gpsMode?: GpsDisplayMode;
  onGpsModeChange?: (mode: GpsDisplayMode) => void;
  analysisMode?: GpsDisplayMode;
  onAnalysisModeChange?: (mode: GpsDisplayMode) => void;
  analysisDisabled?: boolean;
  centerline?: Array<{ lat: number; lon: number }> | null;
  /** When true, omit outer card chrome (parent provides it). */
  embedded?: boolean;
  /** Shorter map for home/hero embeds. */
  compact?: boolean;
  /** Stretch to parent height (session dashboard left column). */
  panel?: boolean;
  headerSlot?: ReactNode;
  /** Track start/finish gate overlay (midpoint + optional endpoints). */
  sfLine?: StartFinishLine | null;
  /** When true, A/B endpoints are draggable (touch + pointer). */
  sfEditing?: boolean;
  onSfEndpointMove?: (which: "a" | "b", lat: number, lon: number) => void;
  /** Shared Street | Satellite selection (persists across Overview/POV). */
  basemap?: BasemapMode;
  onBasemapChange?: (mode: BasemapMode) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const sfLayerRef = useRef<L.LayerGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const onProgressRef = useRef(onProgress);
  const onPreviewProgressRef = useRef(onPreviewProgress);
  const onSfEndpointMoveRef = useRef(onSfEndpointMove);
  const sfEditingRef = useRef(sfEditing);
  const drawableRef = useRef<Array<TrackTrace & { points: GpsPoint[] }>>([]);
  const fittedKeyRef = useRef<string>("");
  const [localBasemap, setLocalBasemap] = useState<BasemapMode>(basemap);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [speedUnit] = useSpeedUnit();
  const activeBasemap = onBasemapChange ? basemap : localBasemap;
  const setActiveBasemap = onBasemapChange ?? setLocalBasemap;

  onProgressRef.current = onProgress;
  onPreviewProgressRef.current = onPreviewProgress;
  onSfEndpointMoveRef.current = onSfEndpointMove;
  sfEditingRef.current = sfEditing;

  const drawable = useMemo(
    () =>
      traces
        .map((trace) => ({
          ...trace,
          points: trace.points.filter(
            (point): point is GpsPoint =>
              point.lat != null && point.lon != null,
          ),
        }))
        .filter((trace) => trace.points.length > 1),
    [traces],
  );
  drawableRef.current = drawable;

  const centerlineGps = useMemo(
    () =>
      (centerline ?? []).filter(
        (point): point is { lat: number; lon: number } =>
          point.lat != null && point.lon != null,
      ),
    [centerline],
  );

  const speeds = drawable.flatMap((trace) =>
    trace.points.map((point) => point.speed),
  );
  const minSpeed = speeds.length ? Math.min(...speeds) : 0;
  const maxSpeed = speeds.length ? Math.max(...speeds) : 1;
  const showLegend =
    drawable.length > 1 || drawable.some((trace) => trace.colorBySpeed);
  const drawKey = tracesKey(drawable);

  // Create map once — fixed framing, scrub-only interaction.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      touchZoom: false,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
      // Scrub via pointer events; map stays locked after fitBounds.
    });
    mapRef.current = map;

    // Marker pane above overlays so car dots stay visible on satellite tiles.
    const markerPane = map.getPane("markerPane");
    if (markerPane) markerPane.style.zIndex = "650";

    layersRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    sfLayerRef.current = L.layerGroup().addTo(map);

    tileRef.current = L.tileLayer(ESRI_IMAGERY.url, {
      attribution: ESRI_IMAGERY.attribution,
      maxZoom: 19,
    }).addTo(map);

    const progressAt = (latlng: L.LatLng) => {
      const current = drawableRef.current;
      if (!current.length) return null;
      return nearestProgress(latlng, current);
    };

    const setTooltipPos = (clientX?: number, clientY?: number) => {
      if (clientX == null || clientY == null) return;
      const rect = map.getContainer().getBoundingClientRect();
      setHoverPos({ x: clientX - rect.left, y: clientY - rect.top });
    };

    // Hover = preview only (ghost marker + readout). Never seeks playback.
    const onMove = (event: L.LeafletMouseEvent) => {
      if (sfEditingRef.current) return;
      const progress = progressAt(event.latlng);
      if (progress == null) return;
      onPreviewProgressRef.current?.(progress);
      setTooltipPos(event.originalEvent.clientX, event.originalEvent.clientY);
    };

    // Click seeks playback + synced YouTube.
    const onClick = (event: L.LeafletMouseEvent) => {
      if (sfEditingRef.current) return;
      const progress = progressAt(event.latlng);
      if (progress == null) return;
      onPreviewProgressRef.current?.(null);
      onProgressRef.current?.(progress);
      setTooltipPos(event.originalEvent.clientX, event.originalEvent.clientY);
    };

    const onLeave = () => {
      onPreviewProgressRef.current?.(null);
      setHoverPos(null);
    };

    // Touch drag seeks (no separate hover on touch). Skip while editing SF.
    const scrubFromTouch = (event: TouchEvent) => {
      if (sfEditingRef.current) return;
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return;
      const rect = map.getContainer().getBoundingClientRect();
      const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
      const latlng = map.containerPointToLatLng(point);
      const progress = progressAt(latlng);
      if (progress == null) return;
      onPreviewProgressRef.current?.(null);
      onProgressRef.current?.(progress);
      setTooltipPos(touch.clientX, touch.clientY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      scrubFromTouch(event);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      if (sfEditingRef.current) return;
      event.preventDefault();
      scrubFromTouch(event);
    };

    map.on("mousemove", onMove);
    map.on("click", onClick);
    const container = map.getContainer();
    // Prefer container mouseleave — Leaflet mouseout fires when crossing polylines.
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });

    const onResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", onResize);
    // Layout changes (POV toggle remount, tools, column reflow) need invalidateSize
    // even when the window size is unchanged — same contract as MapLibre resize().
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    // Observe the wrapper (parent) so height class changes still resize.
    const observeEl = containerRef.current.parentElement ?? containerRef.current;
    if (ro && observeEl) ro.observe(observeEl);
    // First paint often happens before flex/grid settles.
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      map.off("mousemove", onMove);
      map.off("click", onClick);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      markersRef.current = null;
      sfLayerRef.current = null;
      tileRef.current = null;
    };
  }, []);

  // Start/finish gate overlay — keep handle markers stable while dragging.
  const sfPolyRef = useRef<L.Polyline | null>(null);
  const sfMidRef = useRef<L.CircleMarker | null>(null);
  const sfHandleARef = useRef<L.Marker | null>(null);
  const sfHandleBRef = useRef<L.Marker | null>(null);
  const sfDraggingRef = useRef(false);

  useEffect(() => {
    const sfLayer = sfLayerRef.current;
    if (!sfLayer) return;

    const clearSf = () => {
      sfLayer.clearLayers();
      sfPolyRef.current = null;
      sfMidRef.current = null;
      sfHandleARef.current = null;
      sfHandleBRef.current = null;
    };

    if (!sfLine) {
      clearSf();
      return;
    }

    const line = ensureStartFinishEndpoints(sfLine);
    const a = line.a!;
    const b = line.b!;

    if (!sfPolyRef.current) {
      clearSf();
      sfPolyRef.current = L.polyline(
        [
          [a.lat, a.lon],
          [b.lat, b.lon],
        ],
        {
          color: "#fafafa",
          weight: 3,
          opacity: 0.95,
          dashArray: "6 4",
          interactive: false,
        },
      );
      sfMidRef.current = L.circleMarker([line.lat, line.lon], {
        radius: 4,
        color: "#f97316",
        fillColor: "#f97316",
        fillOpacity: 1,
        weight: 1,
        interactive: false,
      });
      sfLayer.addLayer(sfPolyRef.current);
      sfLayer.addLayer(sfMidRef.current);

      (["a", "b"] as const).forEach((which) => {
        const point = which === "a" ? a : b;
        const marker = L.marker([point.lat, point.lon], {
          icon: sfHandleIcon(which.toUpperCase()),
          draggable: sfEditing,
          autoPan: false,
          keyboard: false,
          zIndexOffset: 1200,
          interactive: true,
        });
        marker.on("dragstart", () => {
          sfDraggingRef.current = true;
        });
        marker.on("drag", (event) => {
          const { lat, lng } = (event.target as L.Marker).getLatLng();
          const other =
            which === "a"
              ? sfHandleBRef.current?.getLatLng()
              : sfHandleARef.current?.getLatLng();
          if (other && sfPolyRef.current) {
            sfPolyRef.current.setLatLngs([
              which === "a" ? [lat, lng] : [other.lat, other.lng],
              which === "a" ? [other.lat, other.lng] : [lat, lng],
            ]);
          }
          if (sfMidRef.current && other) {
            sfMidRef.current.setLatLng([
              (lat + other.lat) / 2,
              (lng + other.lng) / 2,
            ]);
          }
          onSfEndpointMoveRef.current?.(which, lat, lng);
        });
        marker.on("dragend", (event) => {
          sfDraggingRef.current = false;
          const { lat, lng } = (event.target as L.Marker).getLatLng();
          onSfEndpointMoveRef.current?.(which, lat, lng);
        });
        if (which === "a") sfHandleARef.current = marker;
        else sfHandleBRef.current = marker;
        sfLayer.addLayer(marker);
      });
    } else if (!sfDraggingRef.current) {
      sfPolyRef.current.setLatLngs([
        [a.lat, a.lon],
        [b.lat, b.lon],
      ]);
      sfMidRef.current?.setLatLng([line.lat, line.lon]);
      sfHandleARef.current?.setLatLng([a.lat, a.lon]);
      sfHandleBRef.current?.setLatLng([b.lat, b.lon]);
    }

    sfHandleARef.current?.dragging?.[sfEditing ? "enable" : "disable"]();
    sfHandleBRef.current?.dragging?.[sfEditing ? "enable" : "disable"]();
  }, [sfLine, sfEditing]);

  // Swap basemap tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const source = activeBasemap === "satellite" ? ESRI_IMAGERY : OSM_STREET;
    tileRef.current = L.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [activeBasemap]);

  // Draw traces + centerline only when geometry identity changes.
  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers || !drawable.length) return;

    layers.clearLayers();
    const bounds = L.latLngBounds([]);

    if (centerlineGps.length > 1) {
      const line = L.polyline(
        centerlineGps.map((point) => [point.lat, point.lon] as [number, number]),
        {
          color: "#a1a1aa",
          weight: 2,
          opacity: 0.75,
          dashArray: "4 6",
          interactive: false,
        },
      );
      layers.addLayer(line);
      bounds.extend(line.getBounds());
    }

    for (const trace of drawable) {
      if (trace.colorBySpeed) {
        for (let i = 1; i < trace.points.length; i += 1) {
          const prev = trace.points[i - 1];
          const next = trace.points[i];
          layers.addLayer(
            L.polyline(
              [
                [prev.lat, prev.lon],
                [next.lat, next.lon],
              ],
              {
                color: speedColor(next.speed, minSpeed, maxSpeed),
                weight: 4,
                opacity: 0.95,
                lineCap: "round",
                lineJoin: "round",
                interactive: false,
              },
            ),
          );
        }
      } else {
        layers.addLayer(
          L.polyline(toLatLngs(trace.points), {
            color: trace.color,
            weight: 4,
            opacity: 0.95,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
          }),
        );
      }

      const start = trace.points[0];
      layers.addLayer(
        L.circleMarker([start.lat, start.lon], {
          radius: 4,
          color: "#fafafa",
          fillColor: "#fafafa",
          fillOpacity: 1,
          weight: 1,
          interactive: false,
        }),
      );

      const crossing = trace.sfCrossing;
      if (
        crossing &&
        Number.isFinite(crossing.lat) &&
        Number.isFinite(crossing.lon)
      ) {
        layers.addLayer(
          L.marker([crossing.lat, crossing.lon], {
            icon: sfCrossingIcon(),
            interactive: false,
            keyboard: false,
            zIndexOffset: 400,
          }),
        );
        bounds.extend([crossing.lat, crossing.lon]);
      }

      if (trace.lapKind === "out" || trace.lapKind === "in") {
        const mid = trace.points[Math.floor(trace.points.length / 2)];
        if (mid) {
          layers.addLayer(
            L.marker([mid.lat, mid.lon], {
              icon: lapKindIcon(trace.lapKind),
              interactive: false,
              keyboard: false,
              zIndexOffset: 350,
            }),
          );
        }
      }

      for (const point of trace.points) {
        bounds.extend([point.lat, point.lon]);
      }
    }

    if (bounds.isValid() && fittedKeyRef.current !== drawKey) {
      map.invalidateSize();
      map.fitBounds(bounds.pad(0.08), { animate: false });
      fittedKeyRef.current = drawKey;
    }
  }, [drawable, centerlineGps, minSpeed, maxSpeed, drawKey]);

  // Playback markers (solid) + optional hover ghost preview.
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    markers.clearLayers();
    if (!drawable.length) return;

    const multi = drawable.length > 1;

    const placeAt = (progress: number, ghost: boolean) => {
      const samples = drawable
        .map((trace) => {
          const point = sampleAtProgress(trace.points, progress);
          return {
            trace,
            point,
            lat: point.lat,
            lon: point.lon,
            bearing: trackBearing(trace.points, progress),
            color: trace.colorBySpeed ? "#f97316" : trace.color,
          };
        })
        .filter((s) => s.lat != null && s.lon != null);

      const positions = separateScrubPositions(
        samples.map((s) => ({
          lat: s.lat,
          lon: s.lon,
          bearing: s.bearing,
        })),
        6,
      );

      samples.forEach((sample, index) => {
        const style: CarMarkerStyle = multi
          ? markerStyleForIndex(index)
          : "filled";
        const pos = positions[index] ?? sample;
        markers.addLayer(
          L.marker([pos.lat, pos.lon], {
            icon: carMarkerIcon(sample.color, style, ghost),
            interactive: false,
            keyboard: false,
            zIndexOffset: (ghost ? 900 : 1000) + index,
          }),
        );
      });

      if (!ghost && samples.length >= 2) {
        const ref = samples[0];
        for (let i = 1; i < samples.length; i += 1) {
          const other = samples[i];
          const gapSec = other.point.t - ref.point.t;
          if (!Number.isFinite(gapSec) || Math.abs(gapSec) >= 30) continue;
          const pos = positions[i] ?? other;
          markers.addLayer(
            L.marker([pos.lat, pos.lon], {
              icon: gapLabelIcon(formatGap(gapSec)),
              interactive: false,
              keyboard: false,
              zIndexOffset: 1100 + i,
            }),
          );
        }
      }
    };

    if (activeProgress != null) placeAt(activeProgress, false);
    if (
      previewProgress != null &&
      (activeProgress == null ||
        Math.abs(previewProgress - activeProgress) > 0.002)
    ) {
      placeAt(previewProgress, true);
    }
  }, [activeProgress, previewProgress, drawable]);

  if (!drawable.length) return null;

  const tooltipProgress = previewProgress ?? activeProgress;
  const tooltipMarkers =
    tooltipProgress == null
      ? []
      : drawable.map((trace) => ({
          trace,
          point: sampleAtProgress(trace.points, tooltipProgress),
        }));

  const shellClass = embedded
    ? "relative flex flex-col"
    : panel
      ? "relative flex flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-2"
      : "relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4";

  return (
    <div className={shellClass}>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${
          panel ? "mb-1.5 shrink-0" : "mb-3 gap-3"
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          {gpsMode && onGpsModeChange ? (
            <GpsModeToggle
              mode={gpsMode}
              onChange={onGpsModeChange}
              label="Map"
              ariaLabel="Map GPS display mode"
            />
          ) : (
            <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
              Map
            </p>
          )}
          {analysisMode && onAnalysisModeChange ? (
            <GpsModeToggle
              mode={analysisMode}
              onChange={onAnalysisModeChange}
              label="Delta"
              ariaLabel="Delta calculation mode"
              disabled={analysisDisabled}
            />
          ) : null}
          <BasemapToggle
            value={activeBasemap}
            onChange={setActiveBasemap}
            compact={compact || panel}
          />
        </div>
        {showLegend ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            {centerlineGps.length > 1 ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-4 rounded-full bg-zinc-500" />
                Centerline
              </span>
            ) : null}
            {drawable.some((trace) => trace.colorBySpeed) ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-10 rounded-full bg-gradient-to-r from-zinc-500 to-orange-500" />
                Slow to fast
              </span>
            ) : null}
            {drawable
              .filter((trace) => !trace.colorBySpeed)
              .map((trace) => (
                <span key={trace.id} className="flex items-center gap-2">
                  <span
                    className="h-1.5 w-4 rounded-full"
                    style={{ background: trace.color }}
                  />
                  {trace.label}
                </span>
              ))}
          </div>
        ) : null}
      </div>
      {headerSlot}
      {/*
        Height / touch / handle chrome live on a WRAPPER. Leaflet mounts on a
        stable inner node — React must never rewrite that node's className when
        sfEditing toggles, or it wipes Leaflet's `leaflet-container` classes and
        the map paints black (lost tiles).
      */}
      <div
        className={`${
          panel
            ? MAP_HEIGHT.panel
            : compact
              ? MAP_HEIGHT.compact
              : MAP_HEIGHT.default
        } w-full ${sfEditing ? "touch-manipulation" : "touch-none"} overflow-hidden rounded-xl [&_.apex-sf-handle]:bg-transparent [&_.apex-sf-handle__btn]:flex [&_.apex-sf-handle__btn]:h-7 [&_.apex-sf-handle__btn]:w-7 [&_.apex-sf-handle__btn]:cursor-pointer [&_.apex-sf-handle__btn]:items-center [&_.apex-sf-handle__btn]:justify-center [&_.apex-sf-handle__btn]:rounded-full [&_.apex-sf-handle__btn]:border-2 [&_.apex-sf-handle__btn]:border-orange-400 [&_.apex-sf-handle__btn]:bg-zinc-950 [&_.apex-sf-handle__btn]:text-[10px] [&_.apex-sf-handle__btn]:font-bold [&_.apex-sf-handle__btn]:text-orange-300 [&_.apex-sf-handle__btn]:shadow-md [&_.leaflet-control-attribution]:bg-zinc-950/80 [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:text-zinc-400 ${sfEditing ? "[&_.leaflet-container]:cursor-pointer" : "[&_.leaflet-container]:cursor-crosshair"}`}
        data-apex-sf-editing={sfEditing ? "1" : "0"}
      >
        <div
          ref={containerRef}
          className="h-full w-full"
          data-apex-map="fixed-scrub"
        />
      </div>
      {tooltipMarkers.length ? (
        <div
          className="pointer-events-none absolute z-[500] min-w-36 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          style={{
            left: hoverPos
              ? `clamp(12px, ${hoverPos.x + 12}px, calc(100% - 160px))`
              : "auto",
            right: hoverPos ? "auto" : "20px",
            top: hoverPos
              ? `clamp(56px, ${hoverPos.y + 48}px, calc(100% - 120px))`
              : "64px",
          }}
          data-apex-scrub-tooltip="1"
        >
          {tooltipMarkers.map((marker) => (
            <div key={marker.trace.id} className="mt-1 first:mt-0">
              {drawable.length > 1 ? (
                <p className="flex items-center gap-2 text-zinc-500">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: marker.trace.colorBySpeed
                        ? "#f97316"
                        : marker.trace.color,
                    }}
                  />
                  {marker.trace.label}
                </p>
              ) : (
                <p className="text-zinc-500">{marker.point.t.toFixed(1)}s</p>
              )}
              <p>{formatSpeed(marker.point.speed, speedUnit)}</p>
              <p>{formatG(marker.point.g ?? 0)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LeafletTrackMap;
