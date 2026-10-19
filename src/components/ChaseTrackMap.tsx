"use client";

import { formatGap } from "@/lib/format";
import {
  clampChaseZoom,
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
};

const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const MARKER_SHAPES = ["ring", "filled", "square", "diamond"] as const;

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

function markerHtml(color: string, shape: (typeof MARKER_SHAPES)[number]) {
  const cls =
    shape === "ring"
      ? "apex-car-marker__dot apex-car-marker__dot--ring apex-car-marker__dot--chase"
      : shape === "square"
        ? "apex-car-marker__dot apex-car-marker__dot--square apex-car-marker__dot--chase"
        : shape === "diamond"
          ? "apex-car-marker__dot apex-car-marker__dot--diamond apex-car-marker__dot--chase"
          : "apex-car-marker__dot apex-car-marker__dot--chase";
  return `<div class="apex-car-marker"><div class="${cls}" style="--apex-car:${color}"></div></div>`;
}

function gapHtml(label: string) {
  return `<div class="apex-car-marker"><span class="apex-car-marker__gap">${label}</span></div>`;
}

/**
 * Heading-up chase camera (MapLibre + Esri raster).
 * Centers on follow lap / centroid, rotates bearing from smoothed track heading.
 */
export function ChaseTrackMap({
  traces,
  activeProgress,
  previewProgress = null,
  onPreviewProgress,
  onProgress,
  prefs,
  pitch = 35,
}: {
  traces: ChaseTrace[];
  activeProgress?: number | null;
  /** Chart hover preview — markers/camera without seeking video. */
  previewProgress?: number | null;
  onPreviewProgress?: (progress: number | null) => void;
  onProgress?: (progress: number | null) => void;
  prefs: MapViewPrefs;
  pitch?: number;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const bearingRef = useRef<number | null>(null);
  const onProgressRef = useRef(onProgress);
  const onPreviewProgressRef = useRef(onPreviewProgress);
  onProgressRef.current = onProgress;
  onPreviewProgressRef.current = onPreviewProgress;

  const drawable = useMemo(
    () =>
      traces
        .map((trace) => ({ ...trace, points: toGps(trace.points) }))
        .filter((trace) => trace.points.length > 1),
    [traces],
  );
  const drawableRef = useRef(drawable);
  drawableRef.current = drawable;

  // Create map once.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: {
        version: 8,
        sources: {
          esri: {
            type: "raster",
            tiles: [ESRI_TILES],
            tileSize: 256,
            attribution:
              'Tiles © <a href="https://www.esri.com/">Esri</a>',
          },
        },
        layers: [
          {
            id: "esri",
            type: "raster",
            source: "esri",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [-122.33, 39.54],
      zoom: prefs.chaseZoom,
      pitch,
      bearing: 0,
      attributionControl: { compact: true },
      interactive: true,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;

    map.on("load", () => {
      // Polylines added/updated in a separate effect.
      map.resize();
    });

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
      onPreviewProgressRef.current?.(progress);
    };
    const onLeave = () => {
      onPreviewProgressRef.current?.(null);
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    const container = map.getContainer();
    container.addEventListener("mouseleave", onLeave);

    return () => {
      container.removeEventListener("mouseleave", onLeave);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create once
  }, []);

  // Draw / update polylines when traces change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const apply = () => {
      // Remove prior lap layers/sources.
      for (const layer of [...map.getStyle().layers ?? []]) {
        if (layer.id.startsWith("lap-line-")) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      }
      for (const key of Object.keys(map.getStyle().sources ?? {})) {
        if (key.startsWith("lap-src-")) {
          if (map.getSource(key)) map.removeSource(key);
        }
      }

      drawable.forEach((trace, index) => {
        const srcId = `lap-src-${trace.id}`;
        const layerId = `lap-line-${trace.id}`;
        const coords = trace.points.map(
          (point) => [point.lon, point.lat] as [number, number],
        );
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
            "line-width": index === 0 ? 3.5 : 2.5,
            "line-opacity": 0.9,
          },
        });
      });
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [drawable]);

  // Camera + markers follow progress.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawable.length) return;

    const progress = previewProgress ?? activeProgress ?? 0;
    const zoom = clampChaseZoom(prefs.chaseZoom);

    const samples = drawable.map((trace) => {
      const point = sampleAtProgress(trace.points, progress);
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
    );
    bearingRef.current = nextBearing;

    map.easeTo({
      center: [follow.lon, follow.lat],
      zoom,
      bearing: nextBearing,
      pitch,
      duration: 0,
      essential: true,
    });

    // Rebuild markers.
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    samples.forEach((sample, index) => {
      const el = document.createElement("div");
      el.innerHTML = markerHtml(
        sample.trace.color,
        MARKER_SHAPES[index % MARKER_SHAPES.length] ?? "filled",
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
      const ref = samples[0];
      for (let i = 1; i < samples.length; i += 1) {
        const other = samples[i];
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

    // Auto-zoom slightly out when following centroid so all stay in frame.
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
  }, [
    activeProgress,
    previewProgress,
    drawable,
    prefs.chaseZoom,
    prefs.followId,
    pitch,
  ]);

  // Expose raw bearing helper for tests without pulling map.
  void bearingAtProgress;

  return (
    <div
      ref={hostRef}
      className="h-[65vh] min-h-[320px] w-full touch-none overflow-hidden rounded-xl sm:min-h-[420px] [&_.maplibregl-ctrl-attrib]:bg-zinc-950/80 [&_.maplibregl-ctrl-attrib]:text-[10px] [&_.maplibregl-ctrl-attrib]:text-zinc-400"
      data-apex-map="chase"
    />
  );
}

export default ChaseTrackMap;
