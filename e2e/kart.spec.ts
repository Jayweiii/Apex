import { expect, test } from "@playwright/test";

/**
 * Apex Kart (#48) — playable at iPhone size with touch: Start on one tap,
 * holding Gas advances the clock and moves the kart along the track.
 */
test.describe("Apex Kart", () => {
  test("starts on one tap and drives with touch controls", async ({ page, isMobile }) => {
    test.setTimeout(150_000);
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
      gate: Number(await probe.getAttribute("data-gate")),
    });
    await expect.poll(async () => (await read()).tick, { timeout: 10_000 }).toBeGreaterThan(30);
    const before = await read();

    const gas = page.locator('[data-apex-kart-control="gas"]');
    const box = await gas.boundingBox();
    expect(box).not.toBeNull();
    // Every control is a ≥44pt target.
    for (const control of await page.locator("[data-apex-kart-control]").all()) {
      const b = await control.boundingBox();
      expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(44);
    }
    await gas.dispatchEvent("pointerdown", { pointerId: 7, pointerType: isMobile ? "touch" : "mouse", isPrimary: true });
    await page.waitForTimeout(2500);
    // Keep driving until the car passes the first gate; the next gate must advance.
    expect(before.gate).toBe(1);
    await expect
      .poll(async () => (await read()).gate, {
        timeout: 40_000,
        message: "next gate advances after driving through a gate",
      })
      .toBeGreaterThan(before.gate);
    await gas.dispatchEvent("pointerup", { pointerId: 7, pointerType: isMobile ? "touch" : "mouse", isPrimary: true });

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
