import { cornerBreakdown, theoreticalBestLap } from "../src/lib/analysis";
import { splitLapsByStartFinish } from "../src/lib/split-laps";
import type { TelemetryPoint } from "../src/lib/types";

function oval(lapNumber: number, timeOffset: number): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  for (let i = 0; i < 120; i += 1) {
    const progress = i / 120;
    const a = progress * Math.PI * 2;
    const speed = 100 + 40 * Math.sin(a * 2) + lapNumber;
    points.push({
      t: timeOffset + progress * 90,
      speed,
      lat: 36.58 + Math.sin(a) * 0.01,
      lon: -121.75 + Math.cos(a) * 0.015,
    });
  }
  return points;
}

function main() {
  const continuous: TelemetryPoint[] = [
    ...oval(1, 0),
    ...oval(2, 95).map((p) => ({ ...p, t: p.t })),
  ];
  // Adjust second loop to start near first point after distance
  const laps = splitLapsByStartFinish(continuous, {
    minLapMeters: 200,
    closeMeters: 80,
  });
  if (laps.length < 1) throw new Error("expected split laps");

  const demoLaps = [
    {
      lapNumber: 1,
      lapTimeMs: 90000,
      points: oval(1, 0).map((p) => ({ ...p, t: p.t })),
    },
    {
      lapNumber: 2,
      lapTimeMs: 91200,
      points: oval(2, 0).map((p, i, arr) => ({
        ...p,
        t: (i / (arr.length - 1)) * 91.2,
        speed: p.speed - 2,
      })),
    },
  ];

  const theo = theoreticalBestLap(demoLaps, 8);
  if (!theo) throw new Error("theoretical best missing");
  if (theo.theoreticalMs > theo.actualBestMs) {
    throw new Error("theoretical best should not exceed actual best");
  }

  const corners = cornerBreakdown(demoLaps[0], demoLaps[1]);
  if (!corners.length) throw new Error("expected corner markers");

  console.log(
    JSON.stringify({
      ok: true,
      splitLaps: laps.length,
      theoreticalMs: theo.theoreticalMs,
      gapMs: theo.gapMs,
      corners: corners.length,
    }),
  );
}

main();
