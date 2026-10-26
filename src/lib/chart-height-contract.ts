/**
 * Shared chart height floors — keep StackedTelemetry / SpeedChart / tests aligned.
 * Page scroll only; no nested overflow panes.
 */
export const STACKED_SPEED_MIN_HEIGHT = 160;
export const STACKED_SPEED_MIN_HEIGHT_SM = 200;
export const SPEED_CHART_COMPACT_MIN_HEIGHT = 100;
export const SPEED_CHART_COMPACT_MIN_HEIGHT_SM = 120;
/**
 * Compare stacked charts — container must leave ≥200px for the cartesian
 * plot after Recharts legend + X axis + margins (~80–100px chrome).
 */
export const COMPARE_CHART_MIN_HEIGHT = 300;
export const COMPARE_CHART_MIN_HEIGHT_SM = 320;
