"use client";

import { GpsModeToggle } from "@/components/GpsModeToggle";
import { formatG } from "@/lib/format";
import type { GpsDisplayMode } from "@/lib/map-match";
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

type GpsPoint = TelemetryPoint & { lat: number; lon: number };

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

function sampleAt(points: GpsPoint[], progress: number): GpsPoint {
  if (points.length === 1) return points[0];
  const position = Math.min(1, Math.max(0, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  const mix = position - index;
  const left = points[index];
  const right = points[index + 1];
  const mixNumber = (a?: number, b?: number) =>
    (a ?? 0) + ((b ?? 0) - (a ?? 0)) * mix;
  return {
    ...right,
    t: mixNumber(left.t, right.t),
    speed: mixNumber(left.speed, right.speed),
    lat: mixNumber(left.lat, right.lat),
    lon: mixNumber(left.lon, right.lon),
    latG: mixNumber(left.latG, right.latG),
    lonG: mixNumber(left.lonG, right.lonG),
    g: mixNumber(left.g, right.g),
  };
}

function toLatLngs(points: GpsPoint[]): L.LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon] as [number, number]);
}

function nearestProgress(
  latlng: L.LatLng,
  traces: Array<TrackTrace & { points: GpsPoint[] }>,
) {
  let bestDistance = Number.POSITIVE_INFINITY;
  let best = 0;
  for (const trace of traces) {
    trace.points.forEach((point, index) => {
      const distance = latlng.distanceTo(
        L.latLng(Number(point.lat), Number(point.lon)),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index / (trace.points.length - 1);
      }
    });
  }
  return best;
}

export function LeafletTrackMap({
  traces,
  activeProgress = null,
  onProgress,
  gpsMode,
  onGpsModeChange,
  centerline,
}: {
  traces: TrackTrace[];
  activeProgress?: number | null;
  onProgress?: (progress: number | null) => void;
  gpsMode?: GpsDisplayMode;
  onGpsModeChange?: (mode: GpsDisplayMode) => void;
  centerline?: Array<{ lat: number; lon: number }> | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const [basemap, setBasemap] = useState<BasemapMode>("satellite");
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    markers: Array<{
      trace: TrackTrace & { points: GpsPoint[] };
      point: GpsPoint;
    }>;
  } | null>(null);

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

  // Create map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
    });
    mapRef.current = map;
    layersRef.current = L.layerGroup().addTo(map);
    markersRef.current = L.layerGroup().addTo(map);

    const tile = L.tileLayer(ESRI_IMAGERY.url, {
      attribution: ESRI_IMAGERY.attribution,
      maxZoom: 19,
    }).addTo(map);
    tileRef.current = tile;

    return () => {
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

  // Draw traces + centerline; bind map click/mousemove for scrubbing.
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
          const segment = L.polyline(
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
            },
          );
          layers.addLayer(segment);
        }
      } else {
        const line = L.polyline(toLatLngs(trace.points), {
          color: trace.color,
          weight: 4,
          opacity: 0.95,
          lineCap: "round",
          lineJoin: "round",
        });
        layers.addLayer(line);
      }

      const start = trace.points[0];
      layers.addLayer(
        L.circleMarker([start.lat, start.lon], {
          radius: 5,
          color: "#fafafa",
          fillColor: "#fafafa",
          fillOpacity: 1,
          weight: 1,
        }),
      );

      for (const point of trace.points) {
        bounds.extend([point.lat, point.lon]);
      }
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12));
    }

    const onMove = (event: L.LeafletMouseEvent) => {
      const progress = nearestProgress(event.latlng, drawable);
      onProgress?.(progress);
      const markers = drawable.map((trace) => ({
        trace,
        point: sampleAt(trace.points, progress),
      }));
      const container = map.getContainer().getBoundingClientRect();
      setHover({
        x: event.originalEvent.clientX - container.left,
        y: event.originalEvent.clientY - container.top,
        markers,
      });
    };
    const onLeave = () => {
      onProgress?.(null);
      setHover(null);
    };

    map.on("mousemove", onMove);
    map.on("click", onMove);
    map.on("mouseout", onLeave);

    return () => {
      map.off("mousemove", onMove);
      map.off("click", onMove);
      map.off("mouseout", onLeave);
    };
  }, [drawable, centerlineGps, minSpeed, maxSpeed, onProgress]);

  // Scrub markers from chart-driven activeProgress.
  useEffect(() => {
    const markers = markersRef.current;
    if (!markers) return;
    markers.clearLayers();
    if (activeProgress == null || !drawable.length) {
      if (activeProgress == null) setHover(null);
      return;
    }
    for (const trace of drawable) {
      const point = sampleAt(trace.points, activeProgress);
      markers.addLayer(
        L.circleMarker([point.lat, point.lon], {
          radius: 7,
          color: trace.colorBySpeed ? "#f97316" : trace.color,
          fillColor: "#fafafa",
          fillOpacity: 1,
          weight: 2,
        }),
      );
    }
  }, [activeProgress, drawable]);

  if (!drawable.length) return null;

  const tooltipMarkers =
    hover?.markers ??
    (activeProgress != null
      ? drawable.map((trace) => ({
          trace,
          point: sampleAt(trace.points, activeProgress),
        }))
      : []);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            Map{gpsMode ? ` · ${gpsMode}` : ""}
          </p>
          {gpsMode && onGpsModeChange ? (
            <GpsModeToggle mode={gpsMode} onChange={onGpsModeChange} />
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
        className="h-[260px] w-full overflow-hidden rounded-xl sm:h-[380px] [&_.leaflet-control-attribution]:bg-zinc-950/80 [&_.leaflet-control-attribution]:text-[10px] [&_.leaflet-control-attribution]:text-zinc-400"
      />
      {tooltipMarkers.length ? (
        <div
          className="pointer-events-none absolute z-[500] min-w-36 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          style={{
            left: `clamp(12px, ${(hover?.x ?? 24) + 12}px, calc(100% - 160px))`,
            top: `clamp(56px, ${(hover?.y ?? 56) + 48}px, calc(100% - 120px))`,
          }}
        >
          {tooltipMarkers.map((marker) => (
            <div key={marker.trace.id} className="mt-1 first:mt-0">
              {drawable.length > 1 ? (
                <p className="text-zinc-500">{marker.trace.label}</p>
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
