"use client";

import type { GpsDisplayMode } from "@/lib/map-match";
import { useCallback, useEffect, useState } from "react";

export const ANALYSIS_MODE_KEY = "apex.analysis-mode";
export const ANALYSIS_MODE_EVENT = "apex:analysis-mode";

/** Default when a snap/centerline exists: snapped. */
export function defaultAnalysisMode(
  hasSnap: boolean,
  stored?: GpsDisplayMode | null,
): GpsDisplayMode {
  if (stored === "raw" || stored === "snapped") {
    // Honor stored choice even when snap is missing (caller disables UI).
    return stored;
  }
  return hasSnap ? "snapped" : "raw";
}

export function readStoredAnalysisMode(): GpsDisplayMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ANALYSIS_MODE_KEY);
    if (raw === "raw" || raw === "snapped") return raw;
  } catch {
    // ignore quota / private mode
  }
  return null;
}

export function writeStoredAnalysisMode(mode: GpsDisplayMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ANALYSIS_MODE_KEY, mode);
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent<GpsDisplayMode>(ANALYSIS_MODE_EVENT, { detail: mode }),
  );
}

/**
 * Persisted Raw vs Snapped mode for delta / corners / theoretical best.
 * Independent of the map display toggle. Instances sync via custom event
 * + storage so sibling panels (map vs corner table) stay aligned.
 */
export function useAnalysisMode(hasSnap: boolean) {
  const [mode, setModeState] = useState<GpsDisplayMode>(() =>
    defaultAnalysisMode(hasSnap, null),
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStoredAnalysisMode();
    setModeState(defaultAnalysisMode(hasSnap, stored));
    setHydrated(true);
  }, [hasSnap]);

  useEffect(() => {
    function onCustom(event: Event) {
      const detail = (event as CustomEvent<GpsDisplayMode>).detail;
      if (detail === "raw" || detail === "snapped") setModeState(detail);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== ANALYSIS_MODE_KEY) return;
      if (event.newValue === "raw" || event.newValue === "snapped") {
        setModeState(event.newValue);
      }
    }
    window.addEventListener(ANALYSIS_MODE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ANALYSIS_MODE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setMode = useCallback((next: GpsDisplayMode) => {
    setModeState(next);
    writeStoredAnalysisMode(next);
  }, []);

  // When snap disappears, force raw for computation; keep stored preference.
  const effective: GpsDisplayMode = hasSnap ? mode : "raw";

  return { mode: effective, storedMode: mode, setMode, hasSnap, hydrated };
}
