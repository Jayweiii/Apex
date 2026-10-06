"use client";

import { hasGps } from "@/lib/compare";
import type { TelemetryPoint } from "@/lib/types";

export type TrackTrace = {
  id: string;
  label: string;
  color: string;
  points: TelemetryPoint[];
  colorBySpeed?: boolean;
};

function speedColor(speed: number, min: number, max: number) {
  const t = max <= min ? 1 : Math.min(1, Math.max(0, (speed - min) / (max - min)));
  const r = Math.round(82 + (249 - 82) * t);
  const g = Math.round(82 + (115 - 82) * t);
  const b = Math.round(90 + (22 - 90) * t);
  return `rgb(${r} ${g} ${b})`;
}

export function TrackMap({ traces }: { traces: TrackTrace[] }) {
  const drawable = traces
    .map((trace) => ({
      ...trace,
      points: trace.points.filter(
        (point): point is TelemetryPoint & { lat: number; lon: number } =>
          point.lat != null && point.lon != null,
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
      x: pad + x * (1 - pad * 2),
      y: pad + y * (1 - pad * 2),
    };
  }

  const speeds = all.map((point) => point.speed);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);
  const showLegend = drawable.length > 1 || drawable.some((trace) => trace.colorBySpeed);

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/40 p-4">
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
      <svg viewBox="0 0 100 100" className="h-[380px] w-full">
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
                    x1={a.x * 100}
                    y1={a.y * 100}
                    x2={b.x * 100}
                    y2={b.y * 100}
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
              <circle cx={start.x * 100} cy={start.y * 100} r={1.3} fill="#fafafa" />
            </g>
          );
        })}
      </svg>
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
