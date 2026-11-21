/**
 * One tap, one press, on touch screens.
 *
 * iOS (Safari and Chrome, which share WebKit) sometimes treats the first tap
 * on a button as a "hover" and only sends the click on a second tap, and a
 * busy page (a game loop running) can make that happen often. Here a touch
 * that goes down and comes up on the same button, without dragging, presses
 * it straight away. The browser's own click for that tap, if it still comes,
 * is dropped, so nothing fires twice and nothing underneath gets a stray
 * click after the screen changes. Mouse, pen-hover and keyboard are untouched.
 */

/** Things a tap should press. */
const PRESSABLE = 'button, a[href], [role="button"], [role="radio"], [role="tab"], [role="switch"], [role="checkbox"], summary';
/** Further than this and it was a drag or a scroll, not a tap. */
const SLOP_PX = 12;
/** A click this soon after a pressed tap, and this close to it, is that tap's own click. */
const SWALLOW_MS = 700;
const SWALLOW_PX = 30;

function pressableFrom(target: EventTarget | null, root: Element): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest(PRESSABLE);
  if (!(el instanceof HTMLElement) || !root.contains(el)) return null;
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return null;
  return el;
}

/** Turn on fast taps inside `root`; returns a cleanup function. */
export function enableFastTap(root: Element): () => void {
  let downId = -1;
  let downEl: HTMLElement | null = null;
  let downX = 0;
  let downY = 0;
  // The last tap pressed here: when the finger lifted (event time) and where.
  let tapStamp = -Infinity;
  let tapX = 0;
  let tapY = 0;

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary) {
      downId = -1;
      return;
    }
    downEl = pressableFrom(e.target, root);
    downId = downEl ? e.pointerId : -1;
    downX = e.clientX;
    downY = e.clientY;
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== downId) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > SLOP_PX) downId = -1;
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === downId) downId = -1;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== downId || !downEl) return;
    const el = downEl;
    downId = -1;
    downEl = null;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > SLOP_PX) return;
    // Still over the same control (the finger did not slide off it)?
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit || !el.contains(hit) || !el.isConnected) return;
    tapStamp = e.timeStamp;
    tapX = e.clientX;
    tapY = e.clientY;
    el.click();
  };
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    // Event times, not handler times: a busy frame cannot stretch the window.
    const since = e.timeStamp - tapStamp;
    if (since < 0 || since > SWALLOW_MS || Math.hypot(e.clientX - tapX, e.clientY - tapY) > SWALLOW_PX) return;
    // The browser's own click for a tap that was already pressed.
    tapStamp = -Infinity;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  const cap: AddEventListenerOptions = { capture: true, passive: true };
  document.addEventListener("pointerdown", onDown, cap);
  document.addEventListener("pointermove", onMove, cap);
  document.addEventListener("pointercancel", onCancel, cap);
  document.addEventListener("pointerup", onUp, cap);
  window.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("pointerdown", onDown, cap);
    document.removeEventListener("pointermove", onMove, cap);
    document.removeEventListener("pointercancel", onCancel, cap);
    document.removeEventListener("pointerup", onUp, cap);
    window.removeEventListener("click", onClick, true);
  };
}
