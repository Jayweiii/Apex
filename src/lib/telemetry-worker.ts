/**
 * Off-main-thread helpers for heavy telemetry transforms on iPhone.
 * Falls back to sync work when Worker is unavailable (SSR / older WebViews).
 */

import {
  CHART_DISPLAY_MAX_POINTS,
  downsampleSeries,
} from "@/lib/chart-downsample";

export type TelemetryWorkerPoint = Record<string, unknown>;

let worker: Worker | null | undefined;

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    worker = null;
    return null;
  }
  try {
    const source = `
      self.onmessage = (event) => {
        const { id, points, maxPoints } = event.data || {};
        if (!Array.isArray(points) || points.length <= maxPoints) {
          self.postMessage({ id, points });
          return;
        }
        const result = [];
        const last = points.length - 1;
        const step = last / (maxPoints - 1);
        for (let i = 0; i < maxPoints; i++) {
          result.push(points[Math.round(i * step)]);
        }
        self.postMessage({ id, points: result });
      };
    `;
    worker = new Worker(
      URL.createObjectURL(new Blob([source], { type: "application/javascript" })),
    );
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

let nextId = 1;

/** Downsample a chart series; uses a Worker when available. */
export function downsampleSeriesAsync<T extends TelemetryWorkerPoint>(
  points: T[],
  maxPoints = CHART_DISPLAY_MAX_POINTS,
): Promise<T[]> {
  if (points.length <= maxPoints) return Promise.resolve(points);
  const w = getWorker();
  if (!w) {
    return Promise.resolve(downsampleSeries(points, maxPoints));
  }
  const id = nextId++;
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.id !== id) return;
      w.removeEventListener("message", onMessage);
      resolve((event.data.points ?? points) as T[]);
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ id, points, maxPoints });
  });
}
