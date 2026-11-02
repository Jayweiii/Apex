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

  test("driving the line passes the next checkpoint gate", async ({ page, isMobile }) => {
    // ?bot=1: the headless bot steers + throttles, like a player holding Gas + Steer.
    await page.goto("/kart?bot=1");
    const start = page.locator("[data-apex-kart-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    const probe = page.locator("[data-apex-kart-probe]");
    await expect(probe).toHaveAttribute("data-gate", "1", { timeout: 10_000 });
    // Gate 1 is ~1/8 of the lap ahead; the next gate must advance to 2.
    await expect(probe).toHaveAttribute("data-gate", "2", { timeout: 45_000 });
  });

  test("held controls are released when the game pauses", async ({ page, isMobile }) => {
    await page.goto("/kart");
    const start = page.locator("[data-apex-kart-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    if (isMobile) await start.tap();
    else await start.click();
    const gas = page.locator('[data-apex-kart-control="gas"]');
    const pointer = { pointerId: 9, pointerType: isMobile ? "touch" : "mouse", isPrimary: true };
    await gas.dispatchEvent("pointerdown", pointer);
    await page.waitForTimeout(800);
    // Leave the app while still "holding" Gas: the release never arrives.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("[data-apex-kart-start]")).toBeVisible();
    await page.locator("[data-apex-kart-start]").click();
    const probe = page.locator("[data-apex-kart-probe]");
    const speedAt = async () => Number(await probe.getAttribute("data-speed"));
    await page.waitForTimeout(2500);
    // Coasting, not accelerating: Gas was released on pause.
    const s1 = await speedAt();
    await page.waitForTimeout(1000);
    expect(await speedAt()).toBeLessThanOrEqual(s1 + 0.01);
  });
});
