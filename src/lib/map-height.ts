/**
 * Explicit map heights for session / compare embeds.
 *
 * Panel mode previously used `h-full min-h-0 flex-1` inside a parent that only
 * had `min-h-[180px]` and no fixed height after nested-scroll removal — MapLibre
 * / Leaflet then painted a near-zero canvas. Prefer viewport-relative sizes so
 * the page keeps natural document scroll (no nested overflow panes).
 *
 * - Mobile: ~55vw tall, floored at 300px
 * - Desktop (sm+): ~50vh tall, floored at 300px
 */
export const MAP_EMBED_HEIGHT_CLASS =
  "h-[55vw] min-h-[300px] sm:h-[50vh] sm:min-h-[300px]";

/** Tailwind `sm` breakpoint (px). */
export const MAP_HEIGHT_SM_PX = 640;

/** Floor matching `min-h-[300px]` — readable on phone and laptop. */
export const MAP_HEIGHT_MIN_PX = 300;

/**
 * Resolved CSS height for the embed classes above (before border/padding).
 * Used by tests to assert desktop + mobile viewports stay ≥ 300px.
 */
export function mapEmbedHeightPx(viewport: {
  width: number;
  height: number;
}): number {
  const useSm = viewport.width >= MAP_HEIGHT_SM_PX;
  const raw = useSm ? 0.5 * viewport.height : 0.55 * viewport.width;
  return Math.max(MAP_HEIGHT_MIN_PX, raw);
}
