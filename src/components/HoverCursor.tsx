"use client";

import {
  createHoverCursorController,
  DEFAULT_PLOT_PAD,
  type HoverCursorController,
  type PlotPad,
} from "@/components/hover-cursor";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const HoverCursorContext = createContext<HoverCursorController | null>(null);

export function useHoverCursor(): HoverCursorController | null {
  return useContext(HoverCursorContext);
}

/**
 * Owns a pointer-x hover cursor for a stacked chart group. Hover line +
 * readout paint via rAF; playback index is separate and ignored while hovering.
 * Pass hoverEnabled={false} while playback is playing to suppress preview.
 */
export function HoverCursorScope({
  children,
  playbackIndex = null,
  onPreviewIndex,
  hoverEnabled = true,
  className,
}: {
  children: ReactNode;
  playbackIndex?: number | null;
  /** Map / external preview only — not used to drive chart React lines. */
  onPreviewIndex?: (index: number | null) => void;
  /** False while playing — no hover line / readout / preview index. */
  hoverEnabled?: boolean;
  className?: string;
}) {
  const cursor = useMemo(() => createHoverCursorController(), []);
  const onPreviewRef = useRef(onPreviewIndex);
  onPreviewRef.current = onPreviewIndex;

  useEffect(() => {
    cursor.setOnIndex((index) => onPreviewRef.current?.(index));
    return () => {
      cursor.setOnIndex(null);
      cursor.dispose();
    };
  }, [cursor]);

  useEffect(() => {
    cursor.setPlaybackIndex(playbackIndex);
  }, [cursor, playbackIndex]);

  useEffect(() => {
    cursor.setEnabled(hoverEnabled);
  }, [cursor, hoverEnabled]);

  return (
    <HoverCursorContext.Provider value={cursor}>
      <div
        className={className}
        data-apex-hover-scope="1"
        data-apex-hover-enabled={hoverEnabled ? "1" : "0"}
        onPointerLeave={() => cursor.leave()}
      >
        {children}
      </div>
    </HoverCursorContext.Provider>
  );
}

/** Thin dashed hover cursor — DOM-positioned, no CSS transition. */
export function HoverCursorLine({
  plotRef,
  pad = DEFAULT_PLOT_PAD,
}: {
  plotRef: RefObject<HTMLElement | null>;
  pad?: PlotPad;
}) {
  const cursor = useHoverCursor();
  const lineRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const line = lineRef.current;
    const plot = plotRef.current;
    if (!cursor || !line || !plot) return;
    return cursor.attachHoverLine(line, plot, pad);
  }, [cursor, plotRef, pad]);

  return (
    <div
      ref={lineRef}
      data-apex-hover-line="1"
      aria-hidden
      className="pointer-events-none absolute top-0 bottom-0 z-[5] w-0 border-l border-dashed border-zinc-300/90"
      style={{
        left: 0,
        opacity: 0,
        transition: "none",
        willChange: "transform, opacity",
      }}
    />
  );
}

/**
 * Bind pointer move on a plot to the shared hover cursor (pointer X = SoT).
 * Does not clear on leave — the scope handles leave for the whole stack.
 */
export function usePlotHoverMove(
  plotRef: RefObject<HTMLElement | null>,
  length: number,
  pad: PlotPad = DEFAULT_PLOT_PAD,
) {
  const cursor = useHoverCursor();

  return useMemo(() => {
    if (!cursor || length < 1) return {};
    return {
      onPointerMove: (event: { clientX: number; buttons?: number }) => {
        if ((event.buttons ?? 0) !== 0) return;
        const plot = plotRef.current;
        if (!plot) return;
        cursor.move({
          clientX: event.clientX,
          plotEl: plot,
          pad,
          length,
        });
      },
    };
  }, [cursor, length, pad, plotRef]);
}

/** Attach a readout element so hover + playback share one rAF paint path. */
export function useHoverReadout(
  formatHover: (index: number) => string,
  formatPlayback: (index: number | null) => string,
): RefObject<HTMLSpanElement | null> {
  const cursor = useHoverCursor();
  const ref = useRef<HTMLSpanElement | null>(null);
  const hoverRef = useRef(formatHover);
  const playRef = useRef(formatPlayback);
  hoverRef.current = formatHover;
  playRef.current = formatPlayback;

  useEffect(() => {
    const el = ref.current;
    if (!cursor || !el) return;
    return cursor.attachReadout(
      el,
      (index) => hoverRef.current(index),
      (index) => playRef.current(index),
    );
  }, [cursor]);

  return ref;
}
