/**
 * Explicit map heights for session / compare embeds.
 *
 * Prefer viewport-relative sizes so the page keeps natural document scroll
 * (no nested overflow panes). Avoid flex `h-full min-h-0` collapse.
 *
 * - Mobile: ~380px (360–400 band)
 * - Desktop (sm+): ~60vh, clamped to 550–600px
 */
export const MAP_EMBED_HEIGHT_CLASS =
  "h-[380px] min-h-[360px] sm:h-[min(60vh,600px)] sm:min-h-[550px]";

/** Tailwind `sm` breakpoint (px). */
export const MAP_HEIGHT_SM_PX = 640;

/** Floor matching mobile `min-h-[360px]`. */
export const MAP_HEIGHT_MIN_PX = 360;

/** Desktop target band. */
export const MAP_HEIGHT_DESKTOP_MIN_PX = 550;
export const MAP_HEIGHT_DESKTOP_MAX_PX = 600;

/**
 * Resolved CSS height for the embed classes above (before border/padding).
 * Used by tests to assert desktop + mobile viewports stay in band.
 */
export function mapEmbedHeightPx(viewport: {
  width: number;
  height: number;
}): number {
  const useSm = viewport.width >= MAP_HEIGHT_SM_PX;
  if (!useSm) {
    // Fixed 380px on phone; floor 360 if class ever uses vw again.
    return Math.max(MAP_HEIGHT_MIN_PX, 380);
  }
  const raw = 0.6 * viewport.height;
  return Math.min(
    MAP_HEIGHT_DESKTOP_MAX_PX,
    Math.max(MAP_HEIGHT_DESKTOP_MIN_PX, raw),
  );
}
