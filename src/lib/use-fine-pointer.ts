"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot() {
  return typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia(QUERY).matches
    : false;
}

/**
 * True only with a real hovering pointer (mouse / trackpad).
 *
 * Hover-only UI (chart tooltips, hover cursors) must be off on touch: iOS
 * Safari fires synthetic mouse events on every tap, and if the page changes
 * in response (a Recharts tooltip hiding when the "mouse" leaves a chart),
 * iOS treats that tap as hover and swallows the click — the "tap twice"
 * bug. Server snapshot is false, so SSR / first paint are touch-safe.
 */
export function useFinePointer(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** For pointer handlers: only real mice drive hover previews. */
export function isMousePointer(event: { pointerType?: string }): boolean {
  return event.pointerType === "mouse";
}

/** Non-hook check for imperative handlers (Leaflet / MapLibre events). */
export function hasFinePointer(): boolean {
  return getSnapshot();
}
