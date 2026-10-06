"use client";

import { formatLapTime } from "@/lib/format";
import type { CornerStat, TheoreticalBest } from "@/lib/analysis";

export function TheoreticalBestCard({ result }: { result: TheoreticalBest }) {
  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-950/50 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-zinc-200">Theoretical best</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Best of {result.sectorCount} equal-distance micro-sectors across the session.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl text-orange-400">
            {formatLapTime(result.theoreticalMs)}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Actual best {formatLapTime(result.actualBestMs)} · gap{" "}
            <span className="text-zinc-300">
              −{(result.gapMs / 1000).toFixed(3)}s
            </span>
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
        {result.sectors.map((sector) => (
          <div
            key={sector.index}
            className="rounded-lg border border-zinc-800/80 px-2 py-2 text-center"
            title={`Best from lap ${sector.bestLapNumber}`}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
              S{sector.index}
            </p>
            <p className="mt-1 font-mono text-xs text-zinc-200">
              {(sector.bestMs / 1000).toFixed(2)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CornerBreakdownTable({
  corners,
  referenceLabel,
  otherLabel,
}: {
  corners: CornerStat[];
  referenceLabel: string;
  otherLabel?: string;
}) {
  if (!corners.length) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
        Not enough speed variation to mark corners on {referenceLabel}.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-800/80">
      <div className="border-b border-zinc-800 bg-zinc-950/80 px-4 py-3">
        <h2 className="text-sm font-medium text-zinc-200">Corner breakdown</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Brake / min / exit for {referenceLabel}
          {otherLabel ? ` vs ${otherLabel}` : ""}.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="px-3 py-2 font-medium">Turn</th>
              <th className="px-3 py-2 font-medium">Brake</th>
              <th className="px-3 py-2 font-medium">Min</th>
              <th className="px-3 py-2 font-medium">Exit</th>
              <th className="px-3 py-2 font-medium">Δ</th>
            </tr>
          </thead>
          <tbody>
            {corners.map((corner) => (
              <tr key={corner.index} className="border-b border-zinc-900/80">
                <td className="px-3 py-3 font-medium text-zinc-200">{corner.label}</td>
                <td className="px-3 py-3 font-mono text-zinc-300">
                  {corner.brakeSpeed.toFixed(0)}
                </td>
                <td className="px-3 py-3 font-mono text-orange-300">
                  {corner.minSpeed.toFixed(0)}
                </td>
                <td className="px-3 py-3 font-mono text-zinc-300">
                  {corner.exitSpeed.toFixed(0)}
                </td>
                <td className="px-3 py-3 font-mono text-zinc-400">
                  {corner.deltaMs == null
                    ? "—"
                    : `${corner.deltaMs >= 0 ? "+" : ""}${(corner.deltaMs / 1000).toFixed(3)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
