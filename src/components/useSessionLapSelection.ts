"use client";

import {
  resolveSelectedLap,
  type LapPick,
} from "@/lib/session-lap-url";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Keeps the selected lap in sync with ?lap=N (number) for shareable URLs.
 * Legacy UUID values in ?lap= still resolve.
 */
export function useSessionLapSelection<T extends LapPick>(laps: T[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lapParam = searchParams.get("lap");
  const videoParam = searchParams.get("v");

  const selected = useMemo(
    () => resolveSelectedLap(laps, lapParam),
    [laps, lapParam],
  );

  const selectLap = useCallback(
    (lap: Pick<LapPick, "lap_number">) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("lap", String(lap.lap_number));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return { selected, selectLap, videoParam, lapParam };
}
