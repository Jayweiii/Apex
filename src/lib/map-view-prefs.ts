"use client";

export type MapCameraMode = "overview" | "chase";

export type MapViewPrefs = {
  mode: MapCameraMode;
  /** Trace id to follow, or `"centroid"` for auto-frame all markers. */
  followId: string;
  /** Chase zoom (satellite-friendly ~16–19). */
  chaseZoom: number;
};

export const MAP_VIEW_PREFS_KEY = "apex.map-view";
export const MAP_VIEW_PREFS_EVENT = "apex:map-view";

export const DEFAULT_MAP_VIEW_PREFS: MapViewPrefs = {
  mode: "overview",
  followId: "",
  chaseZoom: 18,
};

export function clampChaseZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_MAP_VIEW_PREFS.chaseZoom;
  return Math.min(19, Math.max(16, Math.round(zoom * 10) / 10));
}

export function readMapViewPrefs(): MapViewPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_MAP_VIEW_PREFS };
  try {
    const raw = window.localStorage.getItem(MAP_VIEW_PREFS_KEY);
    if (!raw) return { ...DEFAULT_MAP_VIEW_PREFS };
    const parsed = JSON.parse(raw) as Partial<MapViewPrefs>;
    return {
      mode: parsed.mode === "chase" ? "chase" : "overview",
      followId: typeof parsed.followId === "string" ? parsed.followId : "",
      chaseZoom: clampChaseZoom(
        typeof parsed.chaseZoom === "number"
          ? parsed.chaseZoom
          : DEFAULT_MAP_VIEW_PREFS.chaseZoom,
      ),
    };
  } catch {
    return { ...DEFAULT_MAP_VIEW_PREFS };
  }
}

export function writeMapViewPrefs(prefs: MapViewPrefs) {
  if (typeof window === "undefined") return;
  const next: MapViewPrefs = {
    mode: prefs.mode === "chase" ? "chase" : "overview",
    followId: prefs.followId,
    chaseZoom: clampChaseZoom(prefs.chaseZoom),
  };
  try {
    window.localStorage.setItem(MAP_VIEW_PREFS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent<MapViewPrefs>(MAP_VIEW_PREFS_EVENT, { detail: next }),
  );
}
