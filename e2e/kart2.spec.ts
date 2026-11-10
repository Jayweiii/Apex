import { expect, test } from "@playwright/test";

/**
 * Apex Kart rebuild: the game loads at phone size, the stick drives the kart,
 * and pushing the stick screen-left turns the kart left of the camera.
 */

test.describe("Apex Kart rebuild", () => {
  test("loads, the stick drives, and screen-left turns left", async ({ page, isMobile }) => {
    await page.goto("/kart2");
    const start = page.locator("[data-apex-kart2-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();

    const root = page.locator("[data-apex-kart2]");
    await expect(root).toHaveAttribute("data-phase", "countdown");
    await expect(root).toHaveAttribute("data-phase", "racing", { timeout: 8_000 });

    const probe = page.locator("[data-apex-kart2-probe]");
    const read = async () => ({
      tick: Number(await probe.getAttribute("data-tick")),
      x: Number(await probe.getAttribute("data-x")),
      y: Number(await probe.getAttribute("data-y")),
      heading: Number(await probe.getAttribute("data-heading")),
      cam: Number(await probe.getAttribute("data-cam")),
      speed: Number(await probe.getAttribute("data-speed")),
      s: Number(await probe.getAttribute("data-s")),
    });

    const area = page.locator("[data-apex-kart2-stick-area]");
    const ab = (await area.boundingBox())!;
    const ox = ab.x + ab.width / 2;
    const oy = ab.y + ab.height * 0.78;
    const pointerType = isMobile ? "touch" : "mouse";
    const ptr = (x: number, y: number) => ({
      pointerId: 7,
      pointerType,
      isPrimary: true,
      clientX: x,
      clientY: y,
    });

    // Stick up (screen forward) is full throttle along the camera.
    await area.dispatchEvent("pointerdown", ptr(ox, oy));
    await area.dispatchEvent("pointermove", ptr(ox, oy - 70));
    await expect.poll(async () => (await read()).speed, { timeout: 8_000 }).toBeGreaterThan(3);
    const moved = await read();
    await expect
      .poll(async () => {
        const now = await read();
        return Math.hypot(now.x - moved.x, now.y - moved.y);
      }, { timeout: 8_000 })
      .toBeGreaterThan(8);
    await area.dispatchEvent("pointerup", ptr(ox, oy - 70));

    // Held screen-left must settle on one heading. A live chase-camera
    // mapping keeps turning and ends up driving back down the track.
    const holdFrom = await read();
    await area.dispatchEvent("pointerdown", ptr(ox, oy));
    await area.dispatchEvent("pointermove", ptr(ox - 80, oy));
    await page.waitForTimeout(2200);
    const ang = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const settled = await read();
    const latch = Number(await probe.getAttribute("data-latch"));
    const along = Number(await probe.getAttribute("data-along"));
    const yaw = Number(await probe.getAttribute("data-yaw"));
    expect(ang(settled.heading, latch - Math.PI / 2)).toBeLessThan(0.35);
    expect(Math.abs(yaw)).toBeLessThan(0.2);
    expect(along).toBeGreaterThan(-0.35);
    expect(ang(settled.heading, holdFrom.heading)).toBeGreaterThan(0.4);
    await area.dispatchEvent("pointerup", ptr(ox - 80, oy));

    for (const selector of ["[data-apex-kart2-back]", "[data-apex-kart2-pause]", "[data-apex-kart2-mute]"]) {
      const box = await page.locator(selector).boundingBox();
      expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
    }

    await expect(page.locator("[data-apex-kart2-canvas]")).toBeVisible();
    const canvas = await page.locator("[data-apex-kart2-canvas]").boundingBox();
    const viewport = page.viewportSize()!;
    expect(canvas!.height).toBeGreaterThan(viewport.height * 0.5);
    const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollH).toBeLessThanOrEqual(viewport.height + 1);
  });

  test("play surface blocks scroll and ?debug=1 logs touches", async ({ page, isMobile }) => {
    await page.goto("/kart2");
    await expect(page.locator("[data-apex-kart2-start]")).toBeVisible({ timeout: 90_000 });
    const guard = await page.evaluate(() => {
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
    expect(guard).toEqual({ touchstart: true, touchmove: true, overscroll: "none" });
    const back = await page.locator("[data-apex-kart2-back]").boundingBox();
    expect(Math.min(back!.width, back!.height)).toBeGreaterThanOrEqual(44);

    await expect(page.locator("[data-apex-kart2-debug]")).toBeHidden();
    await page.goto("/kart2?debug=1");
    const start = page.locator("[data-apex-kart2-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    const panel = page.locator("[data-apex-kart2-debug]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("debug on");
    await expect(panel).toContainText(/countdown|racing/);
  });
});
