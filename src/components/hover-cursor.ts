/**
 * Pointer-driven chart hover cursor.
 *
 * Source of truth while hovering is pointer X (converted once to a 0..1
 * plot fraction + sample index). Hover line(s) and readout paint in the
 * same rAF — no React state round-trip per chart. Playback progress is a
 * separate solid cursor and is ignored for the readout while hovering.
 *
 * While playback is playing, hover is disabled entirely: no hover line,
 * no hover readout, no map preview index — readouts follow playback only.
 * Seek (click/drag) is owned by chart scrub handlers, not this controller.
 */

export type PlotPad = { left: number; right: number };

export const DEFAULT_PLOT_PAD: PlotPad = { left: 42, right: 8 };

export function fractionFromClientX(
  clientX: number,
  element: HTMLElement | null,
  pad: PlotPad = DEFAULT_PLOT_PAD,
): number | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const inner = Math.max(1, rect.width - pad.left - pad.right);
  const x = clientX - rect.left - pad.left;
  return Math.min(1, Math.max(0, x / inner));
}

export function indexFromFraction(fraction: number, length: number): number {
  if (length < 2) return 0;
  return Math.round(fraction * (length - 1));
}

export function xFromFraction(
  fraction: number,
  element: HTMLElement,
  pad: PlotPad = DEFAULT_PLOT_PAD,
): number {
  const rect = element.getBoundingClientRect();
  const inner = Math.max(1, rect.width - pad.left - pad.right);
  return pad.left + fraction * inner;
}

type LineTarget = {
  el: HTMLElement;
  plotEl: HTMLElement;
  pad: PlotPad;
};

type ReadoutTarget = {
  el: HTMLElement;
  formatHover: (index: number) => string;
  formatPlayback: (index: number | null) => string;
};

export type HoverCursorController = {
  move: (args: {
    clientX: number;
    plotEl: HTMLElement;
    pad?: PlotPad;
    length: number;
  }) => void;
  leave: () => void;
  isHovering: () => boolean;
  getIndex: () => number | null;
  setPlaybackIndex: (index: number | null) => void;
  /**
   * When false (e.g. playback playing), ignore pointer moves and clear any
   * active hover so lines/readouts follow playback only.
   */
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  attachHoverLine: (
    el: HTMLElement,
    plotEl: HTMLElement,
    pad?: PlotPad,
  ) => () => void;
  attachReadout: (
    el: HTMLElement,
    formatHover: (index: number) => string,
    formatPlayback: (index: number | null) => string,
  ) => () => void;
  /** Map / external preview — called from the paint rAF, not separately. */
  setOnIndex: (cb: ((index: number | null) => void) | null) => void;
  dispose: () => void;
};

const LEAVE_DELAY_MS = 48;

export function createHoverCursorController(): HoverCursorController {
  let fraction: number | null = null;
  let hoverIndex: number | null = null;
  let playbackIndex: number | null = null;
  let hovering = false;
  let enabled = true;
  let raf = 0;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let onIndex: ((index: number | null) => void) | null = null;
  let lastEmitted: number | null | undefined = undefined;

  const lines = new Set<LineTarget>();
  const readouts = new Set<ReadoutTarget>();

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      paint();
    });
  };

  const clearHover = () => {
    if (leaveTimer != null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
    hovering = false;
    fraction = null;
    hoverIndex = null;
  };

  const paint = () => {
    const showHover =
      enabled && hovering && fraction != null && hoverIndex != null;

    for (const line of lines) {
      if (!showHover || fraction == null) {
        line.el.style.opacity = "0";
        continue;
      }
      const x = xFromFraction(fraction, line.plotEl, line.pad);
      line.el.style.opacity = "1";
      line.el.style.transform = `translate3d(${x}px,0,0)`;
    }

    for (const readout of readouts) {
      if (showHover && hoverIndex != null) {
        readout.el.textContent = readout.formatHover(hoverIndex);
      } else {
        readout.el.textContent = readout.formatPlayback(playbackIndex);
      }
    }

    const emit = showHover ? hoverIndex : null;
    if (emit !== lastEmitted) {
      lastEmitted = emit;
      onIndex?.(emit);
    }
  };

  return {
    move({ clientX, plotEl, pad = DEFAULT_PLOT_PAD, length }) {
      if (!enabled) return;
      if (leaveTimer != null) {
        clearTimeout(leaveTimer);
        leaveTimer = null;
      }
      const next = fractionFromClientX(clientX, plotEl, pad);
      if (next == null || length < 1) return;
      // Pointer X is the single source of truth for this frame.
      fraction = next;
      hoverIndex = indexFromFraction(next, length);
      hovering = true;
      schedule();
    },

    leave() {
      if (!enabled) return;
      if (leaveTimer != null) clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        hovering = false;
        fraction = null;
        hoverIndex = null;
        schedule();
      }, LEAVE_DELAY_MS);
    },

    isHovering: () => enabled && hovering,

    getIndex: () => (enabled && hovering ? hoverIndex : null),

    setPlaybackIndex(index) {
      playbackIndex = index;
      if (!hovering || !enabled) schedule();
    },

    setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) clearHover();
      schedule();
    },

    isEnabled: () => enabled,

    attachHoverLine(el, plotEl, pad = DEFAULT_PLOT_PAD) {
      const target: LineTarget = { el, plotEl, pad };
      el.style.opacity = "0";
      el.style.willChange = "transform, opacity";
      el.style.transition = "none";
      lines.add(target);
      schedule();
      return () => {
        lines.delete(target);
      };
    },

    attachReadout(el, formatHover, formatPlayback) {
      const target: ReadoutTarget = { el, formatHover, formatPlayback };
      readouts.add(target);
      schedule();
      return () => {
        readouts.delete(target);
      };
    },

    setOnIndex(cb) {
      onIndex = cb;
      lastEmitted = undefined;
    },

    dispose() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (leaveTimer != null) clearTimeout(leaveTimer);
      leaveTimer = null;
      lines.clear();
      readouts.clear();
      onIndex = null;
    },
  };
}
