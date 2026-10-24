"use client";

import {
  DEFAULT_SPEED_UNIT,
  readSpeedUnit,
  SPEED_UNIT_EVENT,
  type SpeedUnit,
  writeSpeedUnit,
} from "@/lib/speed-units";
import { useEffect, useState } from "react";

/** Live preferred speed unit (default mph); persists to localStorage. */
export function useSpeedUnit(): [SpeedUnit, (next: SpeedUnit) => void] {
  const [unit, setUnit] = useState<SpeedUnit>(DEFAULT_SPEED_UNIT);

  useEffect(() => {
    setUnit(readSpeedUnit());
    function onExternal(event: Event) {
      const detail = (event as CustomEvent<SpeedUnit>).detail;
      if (detail === "mph" || detail === "kmh") setUnit(detail);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== "apex.speed-unit") return;
      setUnit(readSpeedUnit());
    }
    window.addEventListener(SPEED_UNIT_EVENT, onExternal);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SPEED_UNIT_EVENT, onExternal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function setPreferred(next: SpeedUnit) {
    writeSpeedUnit(next);
    setUnit(next);
  }

  return [unit, setPreferred];
}
