import { expect, test } from "@playwright/test";

/**
 * The Drive page puts Apex Sim and Apex Rush first: each is a big card with
 * a short looping clip of the real game, what it is, your best, and one tap
 * in. The clips exist, play only while on screen, and stay still for people
 * who asked for reduced motion. The free-drive picker is still there below.
 */
test.describe("Drive hub", () => {
  test("Sim and Rush lead with live previews and one-tap entry", async ({ page, isMobile }) => {
    await page.goto("/drive");
    const sim = page.locator("[data-apex-sim-entry]");
    const rush = page.locator("[data-apex-rush-entry]");
    await expect(sim).toHaveAttribute("href", "/sim");
    await expect(rush).toHaveAttribute("href", "/rush");
    // The featured games come before everything else on the page.
    const simBox = (await sim.boundingBox())!;
    const freeBox = (await page.locator("#free-drive").boundingBox())!;
    expect(simBox.y).toBeLessThan(freeBox.y);
    // Cards are big, easy targets.
    expect(simBox.height).toBeGreaterThan(200);

    for (const clip of ["sim", "rush"]) {
      for (const file of [`${clip}-poster.jpg`, `${clip}-preview.mp4`, `${clip}-preview.webm`]) {
        const res = await page.request.get(`/games/${file}`);
        expect(res.status(), file).toBe(200);
        // Small enough for a phone on cellular.
        expect((await res.body()).length, file).toBeLessThan(2_500_000);
      }
    }
    // The clip on screen plays (muted, inline).
    const video = page.locator('[data-game-preview="sim"]');
    await expect(video).toHaveJSProperty("muted", true);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0), { timeout: 15_000 }).toBe(true);

    // In: one tap on the card.
    if (isMobile) await rush.tap();
    else await rush.click();
    await expect(page).toHaveURL(/\/rush$/);
  });

  test("reduced motion: the previews stay still", async ({ browser }, info) => {
    const use = info.project.use;
    const ctx = await browser.newContext({
      baseURL: use.baseURL,
      viewport: use.viewport,
      userAgent: use.userAgent,
      hasTouch: use.hasTouch,
      isMobile: use.isMobile,
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    await page.goto("/drive");
    const video = page.locator('[data-game-preview="sim"]');
    await expect(video).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await ctx.close();
  });
});
