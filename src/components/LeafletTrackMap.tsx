"use client";

import { GpsModeToggle } from "@/components/GpsModeToggle";
import { formatG } from "@/lib/format";
import type { GpsDisplayMode } from "@/lib/map-match";
import {
  progressNearPoint,
  sampleAtProgress,
  type GpsPoint,
} from "@/lib/scrub";
import type { TelemetryPoint } from "@/lib/types";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
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

  // Create map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      // Keep drag for pan; scrub via mousemove / touch without breaking pan much.
    });
    mapRef.current = map;

    if (!map.getPane("scrub")) {
      map.createPane("scrub");
      const pane = map.getPane("scrub");
      if (pane) pane.style.zIndex = "650";
    }

    layersRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup([], { pane: "scrub" }).addTo(map);

    tileRef.current = L.tileLayer(ESRI_IMAGERY.url, {
      attribution: ESRI_IMAGERY.attribution,
      maxZoom: 19,
    }).addTo(map);

    const emitProgress = (latlng: L.LatLng, clientX?: number, clientY?: number) => {
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
      // One-finger scrub; let two-finger / drag pan remain Leaflet's job.
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

    return () => {
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
      map.fitBounds(bounds.pad(0.12));
      fittedKeyRef.current = drawKey;
    }
  }, [drawable, centerlineGps, minSpeed, maxSpeed, drawKey]);

  // Scrub markers follow shared progress (charts, map, video).
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    markers.clearLayers();
    if (activeProgress == null || !drawable.length) return;

    for (const trace of drawable) {
      const point = sampleAtProgress(trace.points, activeProgress);
      const color = trace.colorBySpeed ? "#f97316" : trace.color;
      markers.addLayer(
        L.circleMarker([point.lat, point.lon], {
          radius: 9,
          color: "#fafafa",
          fillColor: color,
          fillOpacity: 1,
          weight: 3,
          pane: "scrub",
          interactive: false,
        }),
      );
      // Inner highlight for dual-lap readability.
      markers.addLayer(
        L.circleMarker([point.lat, point.lon], {
          radius: 3,
          color: "#fafafa",
          fillColor: "#fafafa",
          fillOpacity: 1,
          weight: 0,
          pane: "scrub",
          interactive: false,
        }),
      );
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

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
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
      <div
        ref={containerRef}
        className="h-[260px] w-full touch-none overflow-hidden rounded-xl sm:h-[380px] [&_.leaflet-control-attribution]:bg-zinc-950/80 [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:text-zinc-400"
      />
      {tooltipMarkers.length ? (
        <div
          className="pointer-events-none absolute z-[500] min-w-36 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          style={{
            left: `clamp(12px, ${(hoverPos?.x ?? 24) + 12}px, calc(100% - 160px))`,
            top: `clamp(56px, ${(hoverPos?.y ?? 56) + 48}px, calc(100% - 120px))`,
          }}
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
