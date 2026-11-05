import { expect, test } from "@playwright/test";

/**
 * Apex Kart (#48) — playable at iPhone size with touch: Start on one tap,
 * holding Gas advances the clock and moves the kart along the track.
 */
test.describe("Apex Kart", () => {
  test("starts on one tap and drives with touch controls", async ({ page, isMobile }) => {
    await page.goto("/kart");
    const start = page.locator("[data-apex-kart-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    await expect(start).toBeHidden();

    // 3-2-1-GO: the race clock must not run until the countdown ends.
    const root = page.locator("[data-apex-kart]");
    await expect(root).toHaveAttribute("data-phase", "countdown");
    expect(Number(await page.locator("[data-apex-kart-probe]").getAttribute("data-tick") ?? 0)).toBe(0);
    await expect(root).toHaveAttribute("data-phase", "racing", { timeout: 8_000 });

    const probe = page.locator("[data-apex-kart-probe]");
    const read = async () => ({
      tick: Number(await probe.getAttribute("data-tick")),
      s: Number(await probe.getAttribute("data-s")),
      gate: Number(await probe.getAttribute("data-gate")),
    });
    await expect.poll(async () => (await read()).tick, { timeout: 10_000 }).toBeGreaterThan(30);
    const before = await read();

    // The old pad buttons are gone: Item is the only control button.
    const controls = page.locator("[data-apex-kart-control]");
    await expect(controls).toHaveCount(1);
    await expect(controls.first()).toHaveAttribute("data-apex-kart-control", "item");
    for (const control of await controls.all()) {
      const b = await control.boundingBox();
      expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(44);
    }

    // Floating stick: touch down mid-stage, point where the kart should go.
    const area = page.locator("[data-apex-kart-stick-area]");
    const ab = (await area.boundingBox())!;
    const ox = ab.x + ab.width / 2;
    const oy = ab.y + ab.height * 0.4;
    const pointerType = isMobile ? "touch" : "mouse";
    const ptr = (id: number, x: number, y: number) => ({
      pointerId: id,
      pointerType,
      isPrimary: id === 7,
      clientX: x,
      clientY: y,
    });
    const stick = page.locator("[data-apex-kart-stick]");
    await expect(stick).toHaveCSS("opacity", "0");
    await area.dispatchEvent("pointerdown", ptr(7, ox, oy));
    await expect(stick).toHaveCSS("opacity", "1"); // appears where the thumb landed
    // Direction-based: point the stick screen-up (the heading-up camera's
    // forward) and the kart drives straight ahead; distance = throttle.
    await area.dispatchEvent("pointermove", ptr(7, ox, oy - 56));
    await page.waitForTimeout(2500);
    // Keep the stick pulled until the next gate registers.
    await expect.poll(async () => (await read()).gate, { timeout: 25_000 }).not.toBe(before.gate);

    // Releasing the stick brakes the kart to a stop.
    await area.dispatchEvent("pointerup", ptr(7, ox, oy - 56));
    await expect(stick).toHaveCSS("opacity", "0");
    const speed = async () => Number(await probe.getAttribute("data-speed"));
    await expect.poll(speed, { timeout: 15_000 }).toBeLessThan(1);

    const after = await read();
    expect(after.tick).toBeGreaterThan(before.tick);
    expect(after.s - before.s).toBeGreaterThan(5);

    // Canvas fills the space between HUD and controls; no page scroll.
    await expect(page.locator("[data-apex-kart-canvas]")).toBeVisible();
    const canvas = await page.locator("[data-apex-kart-canvas]").boundingBox();
    const viewport = page.viewportSize()!;
    expect(canvas!.height).toBeGreaterThan(viewport.height * 0.5);
    const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollH).toBeLessThanOrEqual(viewport.height + 1);
  });

  test("Item button never sticks after a drag-off, cancel or lost capture", async ({ page, isMobile }) => {
    await page.goto("/kart");
    const start = page.locator("[data-apex-kart-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    await expect(page.locator("[data-apex-kart]")).toHaveAttribute("data-phase", "racing", { timeout: 12_000 });

    const item = page.locator('[data-apex-kart-control="item"]');
    const pointerType = isMobile ? "touch" : "mouse";
    const ev = { pointerId: 9, pointerType, isPrimary: true };
    const down = () => item.dispatchEvent("pointerdown", ev);

    // pointercancel releases.
    await down();
    await expect(item).toHaveAttribute("data-held", "1");
    await item.dispatchEvent("pointercancel", ev);
    await expect(item).toHaveAttribute("data-held", "0");

    // lostpointercapture (what the browser fires when a drag-off loses the
    // pointer) releases too.
    await down();
    await expect(item).toHaveAttribute("data-held", "1");
    await item.dispatchEvent("lostpointercapture", ev);
    await expect(item).toHaveAttribute("data-held", "0");

    // After a real drag-off (down on the button, move away, up elsewhere) the
    // button is released and can be pressed again — i.e. items still fire.
    const b = (await item.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await expect(item).toHaveAttribute("data-held", "1");
    await page.mouse.move(b.x + b.width / 2, b.y - 150);
    await page.mouse.up();
    await expect(item).toHaveAttribute("data-held", "0");
    await down();
    await expect(item).toHaveAttribute("data-held", "1");
    await item.dispatchEvent("pointerup", ev);
    await expect(item).toHaveAttribute("data-held", "0");
  });

  test("play surface blocks iOS scroll/bounce and the page can't overscroll", async ({ page }) => {
    // A downward stick drag must never become Safari's pull-down bounce
    // (which cancels the touch = stick released = brakes).
    await page.goto("/kart");
    await expect(page.locator("[data-apex-kart-start]")).toBeVisible({ timeout: 90_000 });
    const result = await page.evaluate(() => {
      const el = document.querySelector("[data-apex-kart-stick-area]") as HTMLElement;
      const fire = (type: string) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      };
      return {
        touchstart: fire("touchstart"),
        touchmove: fire("touchmove"),
        overscroll: getComputedStyle(document.documentElement).overscrollBehaviorY,
      };
    });
    expect(result).toEqual({ touchstart: true, touchmove: true, overscroll: "none" });
    // Back button: a real 44×44 target.
    const back = await page.locator("[data-apex-kart-back]").boundingBox();
    expect(Math.min(back!.width, back!.height)).toBeGreaterThanOrEqual(44);
  });

  test("?debug=1 shows the on-screen touch log; hidden by default", async ({ page, isMobile }) => {
    await page.goto("/kart");
    await expect(page.locator("[data-apex-kart-start]")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("[data-apex-kart-debug]")).toBeHidden();
    await page.goto("/kart?debug=1");
    const start = page.locator("[data-apex-kart-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    const panel = page.locator("[data-apex-kart-debug]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("debug on");
    await expect(panel).toContainText(/countdown|racing/);
  });
});
