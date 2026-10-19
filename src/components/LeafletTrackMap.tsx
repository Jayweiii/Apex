"use client";

import { GpsModeToggle } from "@/components/GpsModeToggle";
import { formatG, formatGap } from "@/lib/format";
import type { GpsDisplayMode } from "@/lib/map-match";
import {
  progressNearPoint,
  sampleAtProgress,
  type GpsPoint,
} from "@/lib/scrub";
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
};

export type BasemapMode = "satellite" | "street";

const ESRI_IMAGERY = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution:
    'Tiles &copy; <a href="https://www.esri.com/">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};

const OSM_STREET = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
};

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
function carMarkerIcon(color: string, style: CarMarkerStyle = "filled") {
  const size = style === "ring" ? 11 : 9;
  const shapeClass =
    style === "ring"
      ? "apex-car-marker__dot apex-car-marker__dot--ring"
      : style === "square"
        ? "apex-car-marker__dot apex-car-marker__dot--square"
        : style === "diamond"
          ? "apex-car-marker__dot apex-car-marker__dot--diamond"
          : "apex-car-marker__dot";
  return L.divIcon({
    className: "apex-car-marker",
    html: `<div class="${shapeClass}" style="--apex-car:${color}"></div>`,
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

export function LeafletTrackMap({
  traces,
  activeProgress = null,
  onProgress,
  gpsMode,
  onGpsModeChange,
  analysisMode,
  onAnalysisModeChange,
  analysisDisabled = false,
  centerline,
  embedded = false,
  headerSlot,
}: {
  traces: TrackTrace[];
  activeProgress?: number | null;
  onProgress?: (progress: number | null) => void;
  gpsMode?: GpsDisplayMode;
  onGpsModeChange?: (mode: GpsDisplayMode) => void;
  analysisMode?: GpsDisplayMode;
  onAnalysisModeChange?: (mode: GpsDisplayMode) => void;
  analysisDisabled?: boolean;
  centerline?: Array<{ lat: number; lon: number }> | null;
  /** When true, omit outer card chrome (parent provides it). */
  embedded?: boolean;
  headerSlot?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const onProgressRef = useRef(onProgress);
  const drawableRef = useRef<Array<TrackTrace & { points: GpsPoint[] }>>([]);
  const fittedKeyRef = useRef<string>("");
  const [basemap, setBasemap] = useState<BasemapMode>("satellite");
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  onProgressRef.current = onProgress;

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

    tileRef.current = L.tileLayer(ESRI_IMAGERY.url, {
      attribution: ESRI_IMAGERY.attribution,
      maxZoom: 19,
    }).addTo(map);

    const emitProgress = (
      latlng: L.LatLng,
      clientX?: number,
      clientY?: number,
    ) => {
      const current = drawableRef.current;
      if (!current.length) return;
      const progress = nearestProgress(latlng, current);
      onProgressRef.current?.(progress);
      if (clientX != null && clientY != null) {
        const rect = map.getContainer().getBoundingClientRect();
        setHoverPos({ x: clientX - rect.left, y: clientY - rect.top });
      }
    };

    const onMove = (event: L.LeafletMouseEvent) => {
      emitProgress(
        event.latlng,
        event.originalEvent.clientX,
        event.originalEvent.clientY,
      );
    };

    const onLeave = () => {
      onProgressRef.current?.(null);
      setHoverPos(null);
    };

    const scrubFromTouch = (event: TouchEvent) => {
      const touch = event.touches[0] ?? event.changedTouches[0];
      if (!touch) return;
      const rect = map.getContainer().getBoundingClientRect();
      const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
      const latlng = map.containerPointToLatLng(point);
      emitProgress(latlng, touch.clientX, touch.clientY);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      scrubFromTouch(event);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      event.preventDefault();
      scrubFromTouch(event);
    };

    map.on("mousemove", onMove);
    map.on("click", onMove);
    const container = map.getContainer();
    // Prefer container mouseleave — Leaflet mouseout fires when crossing polylines.
    container.addEventListener("mouseleave", onLeave);
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: false });

    const onResize = () => {
      map.invalidateSize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      container.removeEventListener("mouseleave", onLeave);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      map.off("mousemove", onMove);
      map.off("click", onMove);
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      markersRef.current = null;
      tileRef.current = null;
    };
  }, []);

  // Swap basemap tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
      tileRef.current = null;
    }
    const source = basemap === "satellite" ? ESRI_IMAGERY : OSM_STREET;
    tileRef.current = L.tileLayer(source.url, {
      attribution: source.attribution,
      maxZoom: 19,
    }).addTo(map);
  }, [basemap]);

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

  // Scrub markers follow shared progress (charts, map, video).
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    markers.clearLayers();
    if (activeProgress == null || !drawable.length) return;

    const multi = drawable.length > 1;
    const samples = drawable.map((trace) => {
      const point = sampleAtProgress(trace.points, activeProgress);
      return {
        trace,
        point,
        lat: point.lat,
        lon: point.lon,
        bearing: trackBearing(trace.points, activeProgress),
        color: trace.colorBySpeed ? "#f97316" : trace.color,
      };
    }).filter((s) => s.lat != null && s.lon != null);

    const positions = separateScrubPositions(
      samples.map((s) => ({
        lat: s.lat,
        lon: s.lon,
        bearing: s.bearing,
      })),
      6,
    );

    samples.forEach((sample, index) => {
      // Distinct shapes when multiple markers overlap (ring = reference).
      const style: CarMarkerStyle = multi
        ? markerStyleForIndex(index)
        : "filled";
      const pos = positions[index] ?? sample;
      markers.addLayer(
        L.marker([pos.lat, pos.lon], {
          icon: carMarkerIcon(sample.color, style),
          interactive: false,
          keyboard: false,
          zIndexOffset: 1000 + index,
        }),
      );
    });

    // Tiny gap labels vs reference (index 0) for each other lap.
    if (samples.length >= 2) {
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
  }, [activeProgress, drawable]);

  if (!drawable.length) return null;

  const tooltipMarkers =
    activeProgress == null
      ? []
      : drawable.map((trace) => ({
          trace,
          point: sampleAtProgress(trace.points, activeProgress),
        }));

  const shellClass = embedded
    ? "relative"
    : "relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4";

  return (
    <div className={shellClass}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
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
          <div
            className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs"
            role="group"
            aria-label="Basemap"
          >
            {(["satellite", "street"] as const).map((value) => {
              const active = basemap === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setBasemap(value)}
                  className={`rounded-md px-2.5 py-1 capitalize transition ${
                    active
                      ? "bg-zinc-100 text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {value}
                </button>
              );
            })}
          </div>
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
      <div
        ref={containerRef}
        className="h-[65vh] min-h-[320px] w-full touch-none overflow-hidden rounded-xl sm:min-h-[420px] [&_.leaflet-control-attribution]:bg-zinc-950/80 [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:text-zinc-400 [&_.leaflet-container]:cursor-crosshair"
        data-apex-map="fixed-scrub"
      />
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
              <p>{marker.point.speed.toFixed(0)} km/h</p>
              <p>{formatG(marker.point.g ?? 0)}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default LeafletTrackMap;
