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

export type ChartScrubHandlers = {
  /** Hover / touch-move without press — preview only (cursor, readout, ghost). */
  onPreviewIndex?: (index: number | null) => void;
  /** Click or drag — seeks playback + synced video. */
  onSeekIndex?: (index: number | null) => void;
};

/**
 * Bind pointer scrub so charts can preview on hover and seek only on
 * click/drag. Hover must never drive video/playback.
 */
export function bindChartScrub(length: number, handlers?: ChartScrubHandlers) {
  const previewAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = indexFromClientX(
      event.clientX,
      event.currentTarget,
      length,
    );
    if (index != null) handlers?.onPreviewIndex?.(index);
  };

  const seekAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const index = indexFromClientX(
      event.clientX,
      event.currentTarget,
      length,
    );
    if (index != null) handlers?.onSeekIndex?.(index);
  };

  return {
    onMouseLeave: () => handlers?.onPreviewIndex?.(null),
    onTouchEnd: () => handlers?.onPreviewIndex?.(null),
    onTouchCancel: () => handlers?.onPreviewIndex?.(null),
    onPointerDown: seekAt,
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.buttons !== 0) {
        seekAt(event);
        return;
      }
      previewAt(event);
    },
  };
}
