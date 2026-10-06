export function hoverIndex(state: {
  activeTooltipIndex?: number | string | null;
}): number | null {
  const index = state?.activeTooltipIndex;
  if (typeof index === "number" && Number.isFinite(index)) return index;
  if (typeof index === "string" && index !== "") {
    const parsed = Number(index);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
