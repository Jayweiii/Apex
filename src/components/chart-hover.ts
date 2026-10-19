/** Resolve the active datum index from a Recharts mouse/touch handler payload. */
export function hoverIndex(state: {
  activeTooltipIndex?: number | string | null;
  activeIndex?: number | string | null;
  isTooltipActive?: boolean;
  event?: MouseEvent | PointerEvent;
}): number | null {
  const raw =
    state?.activeTooltipIndex ??
    state?.activeIndex ??
    null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw !== "") {
    // Recharts 3 TooltipIndex is a string; also accept "children[n]" forms.
    const direct = Number(raw);
    if (Number.isFinite(direct)) return direct;
    const nested = raw.match(/\[(\d+)\]\s*$/);
    if (nested) {
      const parsed = Number(nested[1]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

/** True when the native pointer event is a press/drag (seek), not bare hover. */
export function isSeekPointer(state: unknown): boolean {
  if (!state || typeof state !== "object") return false;
  const native = (state as { event?: { buttons?: number } }).event;
  if (!native) return false;
  return (native.buttons ?? 0) !== 0;
}
