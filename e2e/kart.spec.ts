import { expect, test } from "@playwright/test";

/**
 * Apex Kart (#48) — playable at iPhone size with touch: Start on one tap,
 * holding Gas advances the clock, moves the kart along the track, and the
 * next gate advances once the kart drives through it.
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
    // The first gate to drive through is gate 1.
    expect(before.gate).toBe(1);

    const gas = page.locator('[data-apex-kart-control="gas"]');
    const box = await gas.boundingBox();
    expect(box).not.toBeNull();
    // Every control is a ≥44pt target.
    for (const control of await page.locator("[data-apex-kart-control]").all()) {
      const b = await control.boundingBox();
      expect(Math.min(b!.width, b!.height)).toBeGreaterThanOrEqual(44);
    }
    const pointerType = isMobile ? "touch" : "mouse";
    await gas.dispatchEvent("pointerdown", { pointerId: 7, pointerType, isPrimary: true });
    await page.waitForTimeout(2500);

    const after = await read();
    expect(after.tick).toBeGreaterThan(before.tick);
    expect(after.s - before.s).toBeGreaterThan(5);

    // Keep holding Gas: the kart drives through gate 1 and the next gate advances.
    await expect
      .poll(async () => (await read()).gate, { timeout: 40_000, intervals: [250] })
      .toBeGreaterThan(1);
    await gas.dispatchEvent("pointerup", { pointerId: 7, pointerType, isPrimary: true });

    // Canvas fills the space between HUD and controls; no page scroll.
    const canvas = await page.locator("[data-apex-kart-canvas]").boundingBox();
    const viewport = page.viewportSize()!;
    expect(canvas!.height).toBeGreaterThan(viewport.height * 0.5);
    const scrollH = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(scrollH).toBeLessThanOrEqual(viewport.height + 1);
  });
});
