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
    // Keep Gas held until the next gate registers: it must advance past its start.
    await expect.poll(async () => (await read()).gate, { timeout: 25_000 }).not.toBe(before.gate);
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
