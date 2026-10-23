"use client";

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

/** Free Esri World Imagery — no API key. */
const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

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
 * POV / third-person chase camera (MapLibre + free Esri raster).
 * Centers on follow lap, pitch ~60°, bearing = smoothed travel heading.
 */
export function ChaseTrackMap({
  traces,
  activeProgress,
  previewProgress = null,
  onPreviewProgress,
  onProgress,
  prefs,
  pitch = POV_PITCH_DEG,
  compact = false,
  panel = false,
}: {
  traces: ChaseTrace[];
  activeProgress?: number | null;
  /** Chart hover preview — markers/camera without seeking video. */
  previewProgress?: number | null;
  onPreviewProgress?: (progress: number | null) => void;
  onProgress?: (progress: number | null) => void;
  prefs: MapViewPrefs;
  pitch?: number;
  compact?: boolean;
  panel?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const annotMarkersRef = useRef<Marker[]>([]);
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
      zoom: clampChaseZoom(prefs.chaseZoom || POV_DEFAULT_ZOOM),
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
      map.resize();
    });

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
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawable.length) return;

    const progress = previewProgress ?? activeProgress ?? 0;
    const zoom = clampChaseZoom(prefs.chaseZoom || POV_DEFAULT_ZOOM);

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

    // jumpTo every frame — no animation lag vs playback / hover seek.
    map.jumpTo({
      center: [follow.lon, follow.lat],
      zoom,
      bearing: nextBearing,
      pitch,
    });

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
  }, [
    activeProgress,
    previewProgress,
    drawable,
    prefs.chaseZoom,
    prefs.followId,
    pitch,
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
    />
  );
}

export default ChaseTrackMap;
