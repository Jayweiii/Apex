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

export function bindChartScrub(
  length: number,
  onHoverIndex?: (index: number | null) => void,
) {
  return {
    onMouseLeave: () => onHoverIndex?.(null),
    onTouchEnd: () => onHoverIndex?.(null),
    onTouchCancel: () => onHoverIndex?.(null),
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "touch") {
        const index = indexFromClientX(
          event.clientX,
          event.currentTarget,
          length,
        );
        if (index != null) onHoverIndex?.(index);
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      // Allow move after touchstart even if buttons reporting is flaky.
      const index = indexFromClientX(
        event.clientX,
        event.currentTarget,
        length,
      );
      if (index != null) onHoverIndex?.(index);
    },
  };
}
