/**
 * Shared chart height floors — keep StackedTelemetry / SpeedChart / tests aligned.
 * Page scroll only; no nested overflow panes.
 *
 * Floors target the *cartesian plot* (Recharts grid / clip rect) ≥200px on
 * phone and desktop. Container height must absorb axis/legend chrome (~40–80px).
 */
export const STACKED_SPEED_MIN_HEIGHT = 260;
export const STACKED_SPEED_MIN_HEIGHT_SM = 280;
/** Plot body inside SpeedChart fill shell (slightly under shell for title row). */
export const STACKED_SPEED_BODY_HEIGHT = 220;
export const STACKED_SPEED_BODY_HEIGHT_SM = 240;
export const SPEED_CHART_COMPACT_MIN_HEIGHT = 240;
export const SPEED_CHART_COMPACT_MIN_HEIGHT_SM = 260;
export const CHANNEL_CHART_MIN_HEIGHT = 240;
export const CHANNEL_CHART_MIN_HEIGHT_SM = 260;
export const G_CHART_ROW_MIN_HEIGHT = 240;
export const G_CHART_ROW_MIN_HEIGHT_SM = 260;
/**
 * Compare stacked charts — container must leave ≥200px for the cartesian
 * plot after Recharts legend + X axis + margins (~80–100px chrome).
 */
export const COMPARE_CHART_MIN_HEIGHT = 320;
export const COMPARE_CHART_MIN_HEIGHT_SM = 340;
/** Minimum measured cartesian plot height (grid/clip) across viewports. */
export const MIN_PLOT_AREA_PX = 200;
