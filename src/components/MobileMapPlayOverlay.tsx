"use client";

/**
 * Mobile-only Play/Pause overlaid on the map canvas so session/compare
 * playback is reachable without scrolling past video/charts (docs/UI_RULES.md).
 *
 * - Absolute inside the map stack (scrolls with the map — never fixed over
 *   the sticky AppHeader).
 * - Bottom-left keeps Street/Satellite + POV chrome clear (top row).
 * - sm:hidden — desktop keeps the full PlaybackControls bar.
 * - Single-tap: apex-btn + touch-action:manipulation; ≥44pt tap target.
 */
export function MobileMapPlayOverlay({
  playing,
  onTogglePlay,
  disabled = false,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 z-[20] sm:hidden"
      data-apex-map-play-overlay="1"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onTogglePlay();
        }}
        onPointerDown={(event) => {
          // Keep map scrub/hover from eating the first tap.
          event.stopPropagation();
        }}
        className="apex-btn apex-btn--primary apex-btn--cta pointer-events-auto min-w-[5.5rem] px-3 text-xs shadow-lg shadow-black/40"
        style={{ minHeight: "var(--apex-tap-min)" }}
        aria-label={playing ? "Pause" : "Play"}
        data-apex-play-toggle
        data-apex-map-play-toggle="1"
      >
        {playing ? "Pause" : "Play"}
      </button>
    </div>
  );
}
