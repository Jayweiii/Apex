import type { PointerEvent as ReactPointerEvent } from "react";

/** Pointer/touch helpers for scrubbing Recharts series by X position. */

export function indexFromClientX(
  clientX: number,
  element: HTMLElement | null,
  length: number,
  paddingLeft = 42,
  paddingRight = 8,
): number | null {
  if (!element || length < 2) return null;
  const rect = element.getBoundingClientRect();
  const inner = Math.max(1, rect.width - paddingLeft - paddingRight);
  const x = clientX - rect.left - paddingLeft;
  const fraction = Math.min(1, Math.max(0, x / inner));
  return Math.round(fraction * (length - 1));
}

/**
 * Bind pointer scrub so chart hover updates shared cursor even when Recharts
 * onMouseMove / activeTooltipIndex is missing (common with number axes).
 */
export function bindChartScrub(
  length: number,
  onHoverIndex?: (index: number | null) => void,
) {
  const scrubAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = indexFromClientX(
      event.clientX,
      event.currentTarget,
      length,
    );
    if (index != null) onHoverIndex?.(index);
  };

  return {
    onMouseLeave: () => onHoverIndex?.(null),
    onTouchEnd: () => onHoverIndex?.(null),
    onTouchCancel: () => onHoverIndex?.(null),
    onPointerDown: scrubAt,
    onPointerMove: scrubAt,
  };
}
