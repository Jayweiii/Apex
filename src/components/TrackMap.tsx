"use client";

import { hasGps } from "@/lib/compare";
import { formatG } from "@/lib/format";
import type { TelemetryPoint } from "@/lib/types";
import { useState } from "react";

export type TrackTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  colorBySpeed?: boolean;
};

type GpsPoint = TelemetryPoint & { lat: number; lon: number };

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
  const mixNumber = (a?: number, b?: number) => (a ?? 0) + ((b ?? 0) - (a ?? 0)) * mix;
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

export function TrackMap({
  traces,
  activeProgress = null,
  onProgress,
}: {
  traces: TrackTrace[];
  activeProgress?: number | null;
  onProgress?: (progress: number | null) => void;
}) {
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const drawable = traces
    .map((trace) => ({
      ...trace,
      points: trace.points.filter(
        (point): point is GpsPoint => point.lat != null && point.lon != null,
      ),
    }))
    .filter((trace) => trace.points.length > 1);

  if (!drawable.length) return null;

  const all = drawable.flatMap((trace) => trace.points);
  const minLat = Math.min(...all.map((point) => point.lat));
  const maxLat = Math.max(...all.map((point) => point.lat));
  const minLon = Math.min(...all.map((point) => point.lon));
  const maxLon = Math.max(...all.map((point) => point.lon));
  const midLat = (minLat + maxLat) / 2;
  const cos = Math.cos((midLat * Math.PI) / 180) || 1;
  const spanX = Math.max((maxLon - minLon) * cos, 1e-8);
  const spanY = Math.max(maxLat - minLat, 1e-8);
  const pad = 0.08;

  function xy(lat: number, lon: number) {
    const x = ((lon - minLon) * cos) / spanX;
    const y = (maxLat - lat) / spanY;
    return {
      x: (pad + x * (1 - pad * 2)) * 100,
      y: (pad + y * (1 - pad * 2)) * 100,
    };
  }

  const speeds = all.map((point) => point.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const showLegend = drawable.length > 1 || drawable.some((trace) => trace.colorBySpeed);
  const progress = activeProgress;

  function nearestProgress(x: number, y: number) {
    let bestDistance = Number.POSITIVE_INFINITY;
    let best = 0;
    for (const trace of drawable) {
      trace.points.forEach((point, index) => {
        const projected = xy(point.lat, point.lon);
        const distance = (projected.x - x) ** 2 + (projected.y - y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index / (trace.points.length - 1);
        }
      });
    }
    return best;
  }

  const markers =
    progress == null
      ? []
      : drawable.map((trace) => {
          const point = sampleAt(trace.points, progress);
          return { trace, point, at: xy(point.lat, point.lon) };
        });

  return (
    <div className="relative rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">GPS</p>
        {showLegend ? (
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
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
      <svg
        viewBox="0 0 100 100"
        className="h-[380px] w-full"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * 100;
          const y = ((event.clientY - rect.top) / rect.height) * 100;
          setPointer({ x, y });
          onProgress?.(nearestProgress(x, y));
        }}
        onMouseLeave={() => {
          setPointer(null);
          onProgress?.(null);
        }}
      >
        {drawable.map((trace) => {
          const start = xy(trace.points[0].lat, trace.points[0].lon);
          return (
            <g key={trace.id}>
              {trace.points.slice(1).map((point, index) => {
                const prev = trace.points[index];
                const a = xy(prev.lat, prev.lon);
                const b = xy(point.lat, point.lon);
                return (
                  <line
                    key={`${trace.id}-${index}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={
                      trace.colorBySpeed
                        ? speedColor(point.speed, minSpeed, maxSpeed)
                        : trace.color
                    }
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                );
              })}
              <circle cx={start.x} cy={start.y} r={1.3} fill="#fafafa" />
            </g>
          );
        })}
        {markers.map((marker) => (
          <circle
            key={marker.trace.id}
            cx={marker.at.x}
            cy={marker.at.y}
            r={2.1}
            fill="#fafafa"
            stroke={marker.trace.colorBySpeed ? "#f97316" : marker.trace.color}
            strokeWidth={0.8}
          />
        ))}
      </svg>
      {markers.length ? (
        <div
          className="pointer-events-none absolute z-10 min-w-36 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-100 shadow-lg"
          style={{
            left: `clamp(12px, ${((pointer?.x ?? markers[0].at.x) / 100) * 70 + 8}%, calc(100% - 160px))`,
            top: `clamp(48px, ${((pointer?.y ?? markers[0].at.y) / 100) * 70 + 36}%, calc(100% - 120px))`,
          }}
        >
          {markers.map((marker) => (
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

export function lapHasGps(points: TelemetryPoint[]) {
  return hasGps(points);
}

export function MissingGps() {
  return (
    <p className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 px-4 py-3 text-sm text-zinc-400">
      No GPS in this file. It needs latitude and longitude columns named{" "}
      <span className="text-zinc-200">lat</span> and{" "}
      <span className="text-zinc-200">lon</span>. Load the sample session to see a
      track.
    </p>
  );
}
