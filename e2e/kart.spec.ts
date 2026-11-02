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

    const probe = page.locator("[data-apex-kart-probe]");
    const read = async () => ({
      tick: Number(await probe.getAttribute("data-tick")),
      s: Number(await probe.getAttribute("data-s")),
    });
    await expect.poll(async () => (await read()).tick, { timeout: 10_000 }).toBeGreaterThan(30);
    const before = await read();

    // The only controls are the floating stick surface + a ≥44pt Item button.
    await expect(page.locator("[data-apex-kart-control]")).toHaveCount(1);
    for (const control of await page.locator("[data-apex-kart-control]").all()) {
      const b = await control.boundingBox();
      expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(44);
    }
    // Touch down, pull the stick down (throttle), hold, release.
    const stick = page.locator("[data-apex-kart-stick]");
    const sb = (await stick.boundingBox())!;
    const x = sb.x + sb.width / 2;
    const y = sb.y + sb.height / 2;
    const ev = { pointerId: 7, pointerType: isMobile ? "touch" : "mouse", isPrimary: true };
    await stick.dispatchEvent("pointerdown", { ...ev, clientX: x, clientY: y });
    await stick.dispatchEvent("pointermove", { ...ev, clientX: x, clientY: y + 60 });
    await page.waitForTimeout(2500);
    await stick.dispatchEvent("pointerup", { ...ev, clientX: x, clientY: y + 60 });

    const after = await read();
    expect(after.tick).toBeGreaterThan(before.tick);
    expect(after.s - before.s).toBeGreaterThan(5);

    // Canvas fills the space between HUD and controls; no page scroll.
    const canvas = await page.locator("[data-apex-kart-canvas]").boundingBox();
    const viewport = page.viewportSize()!;
    expect(canvas!.height).toBeGreaterThan(viewport.height * 0.5);
    const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollH).toBeLessThanOrEqual(viewport.height + 1);
  });
});
