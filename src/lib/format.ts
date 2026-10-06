export function formatLapTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

export function formatG(value: number, signed = false): string {
  if (!Number.isFinite(value)) return "—";
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "-" : "") : "";
  return `${sign}${Math.abs(value).toFixed(2)} g`;
}

export function formatGap(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const sign = seconds > 0 ? "+" : seconds < 0 ? "-" : "";
  return `${sign}${Math.abs(seconds).toFixed(3)}s`;
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0.0";
  return `${seconds.toFixed(1)}s`;
}
