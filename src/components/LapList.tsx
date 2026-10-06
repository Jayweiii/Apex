import { formatLapTime } from "@/lib/format";
import type { LapRow } from "@/lib/types";
import Link from "next/link";

export function LapList({
  sessionId,
  laps,
}: {
  sessionId: string;
  laps: LapRow[];
}) {
  const fastest = Math.min(...laps.map((lap) => lap.lap_time_ms));

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800/80">
      <div className="grid grid-cols-[4rem_1fr_auto] border-b border-zinc-800 bg-zinc-950/80 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        <span>Lap</span>
        <span>Time</span>
        <span className="text-right">Delta</span>
      </div>
      <ul>
        {laps.map((lap) => {
          const isFastest = lap.lap_time_ms === fastest;
          const delta = lap.lap_time_ms - fastest;
          return (
            <li key={lap.id}>
              <Link
                href={`/sessions/${sessionId}/laps/${lap.id}`}
                className="grid grid-cols-[4rem_1fr_auto] items-center px-4 py-3 transition hover:bg-zinc-900/80"
              >
                <span className="font-mono text-sm text-zinc-400">
                  {String(lap.lap_number).padStart(2, "0")}
                </span>
                <span
                  className={`font-mono text-lg tracking-tight ${
                    isFastest ? "text-orange-400" : "text-zinc-100"
                  }`}
                >
                  {formatLapTime(lap.lap_time_ms)}
                  {isFastest ? (
                    <span className="ml-2 text-[10px] font-sans uppercase tracking-[0.2em] text-orange-500">
                      Best
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-sm text-zinc-500">
                  {delta === 0 ? "—" : `+${(delta / 1000).toFixed(3)}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
