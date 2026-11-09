/**
 * iOS Safari touch hardening for the kart play surface.
 *
 * `touch-action: none` alone doesn't stop iOS from claiming some drags as
 * its own gestures: a downward drag (the stick's throttle direction) can
 * start the page's rubber-band / pull-down bounce, and Safari then sends
 * `pointercancel` — which the game reads as "stick released" (brakes). We
 * block those gestures outright on the play surface with non-passive touch
 * listeners, and turn off overscroll for the whole page while the game is
 * mounted. Pointer events still fire, so the stick keeps working.
 */

/** Block scroll / bounce / pinch on `el`; returns a cleanup function. */
export function guardPlaySurface(el: HTMLElement): () => void {
  const block = (e: Event) => {
    if (e.cancelable) e.preventDefault();
  };
  const opts: AddEventListenerOptions = { passive: false };
  el.addEventListener("touchstart", block, opts);
  el.addEventListener("touchmove", block, opts);
  // Safari's proprietary pinch events.
  el.addEventListener("gesturestart", block, opts);
  el.addEventListener("gesturechange", block, opts);
  return () => {
    el.removeEventListener("touchstart", block);
    el.removeEventListener("touchmove", block);
    el.removeEventListener("gesturestart", block);
    el.removeEventListener("gesturechange", block);
  };
}

/** Disable page-level overscroll (rubber-band) while the game is mounted. */
export function lockPageOverscroll(): () => void {
  const html = document.documentElement;
  const body = document.body;
  const prev = [html.style.overscrollBehavior, body.style.overscrollBehavior, body.style.overflow];
  html.style.overscrollBehavior = "none";
  body.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  return () => {
    html.style.overscrollBehavior = prev[0];
    body.style.overscrollBehavior = prev[1];
    body.style.overflow = prev[2];
  };
}

/**
 * `?debug=1` on-screen event log, so iOS-only problems can be seen on a real
 * phone (screenshot it). Logs pointer / touch / focus events with whether
 * they were cancelled, plus a live state line from `getState`. Display only:
 * listeners are passive and capture-phase, so they never change behaviour.
 */
export function attachTouchDebug(
  panel: HTMLElement,
  getState: () => string,
): () => void {
  const lines: string[] = [];
  const t0 = performance.now();
  let lastMove = 0;
  let dirty = true;
  const push = (text: string) => {
    lines.push(`${((performance.now() - t0) / 1000).toFixed(2)} ${text}`);
    if (lines.length > 14) lines.shift();
    dirty = true;
  };
  const onPointer = (e: PointerEvent) => {
    if (e.type === "pointermove") {
      const now = performance.now();
      if (now - lastMove < 120) return;
      lastMove = now;
    }
    const target = e.target instanceof HTMLElement ? e.target.dataset : {};
    const where = target.apexKartStickArea ? "stick" : target.apexKartControl ?? (e.target as Element)?.tagName?.toLowerCase();
    push(`${e.type.replace("pointer", "ptr ")} #${e.pointerId} ${e.pointerType} ${Math.round(e.clientX)},${Math.round(e.clientY)} @${where}`);
  };
  const onTouch = (e: TouchEvent) => {
    push(`${e.type} n=${e.touches.length}${e.defaultPrevented ? " (blocked)" : ""}`);
  };
  const onOther = (e: Event) => push(e.type + (e.type === "visibilitychange" ? `:${document.visibilityState}` : ""));
  const pointerTypes = ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"] as const;
  const touchTypes = ["touchstart", "touchend", "touchcancel"] as const;
  const cap: AddEventListenerOptions = { capture: true, passive: true };
  for (const t of pointerTypes) window.addEventListener(t, onPointer, cap);
  // Bubble phase for touches, so "(blocked)" reflects the play-surface guard.
  for (const t of touchTypes) window.addEventListener(t, onTouch, { passive: true });
  window.addEventListener("blur", onOther);
  document.addEventListener("visibilitychange", onOther);
  push(`debug on · ${navigator.userAgent.match(/(iPhone OS|Android|Mac OS X) [\d_.]+/)?.[0] ?? "unknown OS"}`);

  let raf = 0;
  let lastPaint = 0;
  const paint = (now: number) => {
    raf = requestAnimationFrame(paint);
    if (now - lastPaint < 100) return; // ≤10 Hz, cheap
    lastPaint = now;
    const text = `${getState()}\n${lines.join("\n")}`;
    if (dirty || panel.textContent !== text) {
      panel.textContent = text;
      dirty = false;
    }
  };
  raf = requestAnimationFrame(paint);
  return () => {
    cancelAnimationFrame(raf);
    for (const t of pointerTypes) window.removeEventListener(t, onPointer, cap);
    for (const t of touchTypes) window.removeEventListener(t, onTouch);
    window.removeEventListener("blur", onOther);
    document.removeEventListener("visibilitychange", onOther);
  };
}
