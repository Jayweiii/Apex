import { expect, test, type Page } from "@playwright/test";

/**
 * "Report a bug": footer link on the site, and an item in each game's pause
 * menu. The sheet shows the auto-attached context and a mailto / copy action.
 */
const EMAIL = /jwei(%2B|\+)apexbug(%40|@)mail\.grokbot\.com/;

async function tap(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector).first();
  if (isMobile) await el.tap();
  else await el.click();
}

/** The pause-menu item sits clear of the stick and the HUD pause button. */
async function expectNoOverlap(page: Page, itemSel: string, otherSels: string[]) {
  const item = (await page.locator(itemSel).first().boundingBox())!;
  expect(item).toBeTruthy();
  expect(Math.min(item.width, item.height), "tap target >= 44px").toBeGreaterThanOrEqual(44);
  for (const sel of otherSels) {
    const loc = page.locator(sel).first();
    if (!(await loc.isVisible().catch(() => false))) continue;
    const o = (await loc.boundingBox())!;
    const apart = item.x + item.width <= o.x || o.x + o.width <= item.x || item.y + item.height <= o.y || o.y + o.height <= item.y;
    expect(apart, `${itemSel} must not overlap ${sel}`).toBe(true);
  }
}

async function checkSheet(page: Page, itemSel: string, isMobile: boolean, route: string) {
  await tap(page, itemSel, isMobile);
  const sheet = page.locator("[data-bug-report-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("What went wrong?")).toBeVisible();
  const note = sheet.locator("[data-bug-report-note]");
  await note.fill("steering feels stuck p");
  await expect(note).toHaveValue("steering feels stuck p");

  const ctx = await sheet.locator("[data-bug-report-context]").innerText();
  expect(ctx).toContain(`Route: ${route}`);
  expect(ctx).toMatch(/Build: (dev|[0-9a-f]{7})/);
  expect(ctx).toMatch(/Viewport: \d+x\d+/);
  expect(ctx).toContain("Pixel ratio:");
  expect(ctx).toContain("User agent:");
  expect(ctx).toContain("Touch:");
  expect(ctx).toContain("Controls:");
  expect(ctx).not.toMatch(/cookie|token|supabase/i);

  const href = (await sheet.locator("[data-bug-report-email]").getAttribute("href"))!;
  expect(href.startsWith("mailto:")).toBe(true);
  expect(href).toMatch(EMAIL);
  expect(href.length).toBeLessThanOrEqual(1800);
  const decoded = decodeURIComponent(href);
  expect(decoded).toContain(`Apex bug: ${route}`);
  expect(decoded).toContain("steering feels stuck p");

  for (const sel of ["[data-bug-report-email]", "[data-bug-report-copy]", "[data-bug-report-close]"]) {
    const b = (await sheet.locator(sel).boundingBox())!;
    expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(44);
  }
  const panel = (await sheet.locator("[role=dialog]").boundingBox())!;
  const vp = page.viewportSize()!;
  expect(panel.x).toBeGreaterThanOrEqual(0);
  expect(panel.x + panel.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(panel.y + panel.height).toBeLessThanOrEqual(vp.height + 0.5);

  await sheet.locator("[data-bug-report-close]").evaluate((el) => (el as HTMLElement).click());
  await expect(sheet).toHaveCount(0);
  // Back on the pause menu.
  await expect(page.locator(itemSel).first()).toBeVisible();
}

test.describe("Report a bug", () => {
  for (const path of ["/", "/this-page-does-not-exist"]) {
    test(`footer link on ${path}`, async ({ page, isMobile }) => {
      await page.goto(path);
      const link = page.locator('footer [data-bug-report-open="footer"]');
      await expect(link).toBeVisible({ timeout: 60_000 });
      await expect(link).toHaveText("Report a bug");
      await tap(page, 'footer [data-bug-report-open="footer"]', isMobile);
      await expect(page.locator("[data-bug-report-sheet]")).toBeVisible();
      const href = await page.locator("[data-bug-report-email]").getAttribute("href");
      expect(href).toMatch(EMAIL);
      expect(decodeURIComponent(href!)).toContain(`Apex bug: ${path}`);
      await page.locator("[data-bug-report-copy]").click();
      await expect(page.locator("[data-bug-report-sheet] [role=status]")).toHaveText("Copied");
    });
  }

  test("rush: pause menu item opens the sheet", async ({ page, isMobile }) => {
    await page.goto("/rush?auto=1");
    await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-rush-start]", isMobile);
    await expect(page.locator("[data-rush-canvas]")).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    await tap(page, "[data-rush-pause]", isMobile);
    await expect(page.locator("[data-rush-paused]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Report a bug" })).toBeVisible();
    const item = '[data-bug-report-open="rush"]';
    await expectNoOverlap(page, item, ["[data-rush-pause]", "[data-rush-nitro]", ".rush-stick"]);
    await checkSheet(page, item, isMobile, "/rush");
    await expect(page.locator("[data-rush-paused]")).toBeVisible();
  });

  for (const [name, route, start, pause, stick] of [
    ["kart", "/kart", "[data-apex-kart-start]", "[data-apex-kart-pause]", "[data-apex-kart-stick]"],
    ["kart2", "/kart2", "[data-apex-kart2-start]", "[data-apex-kart2-pause]", "[data-apex-kart2-stick]"],
  ] as const) {
    test(`${name}: pause menu item opens the sheet`, async ({ page, isMobile }) => {
      await page.goto(route);
      await expect(page.locator(start)).toBeVisible({ timeout: 90_000 });
      await tap(page, start, isMobile);
      await expect(page.locator(pause)).toBeVisible();
      await tap(page, pause, isMobile);
      await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Report a bug" })).toBeVisible();
      const item = `[data-bug-report-open="${name}"]`;
      await expectNoOverlap(page, item, [pause, stick]);
      await checkSheet(page, item, isMobile, route);
      await expect(page.getByRole("heading", { name: "Paused" })).toBeVisible();
    });
  }

  test("drive: pause menu item opens the sheet", async ({ page, isMobile }) => {
    await page.goto("/drive/thunderhill-west");
    const start = page.locator("[data-apex-drive-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-apex-drive-start]", isMobile);
    const item = page.locator('[data-bug-report-open="drive"]');
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    // Pause only takes effect once the countdown is over.
    await expect(async () => {
      if (!(await item.isVisible())) await pause.click({ timeout: 2_000 });
      await expect(item).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
    await expectNoOverlap(page, '[data-bug-report-open="drive"]', ["[data-apex-drive-minimap]"]);
    await checkSheet(page, '[data-bug-report-open="drive"]', isMobile, "/drive/thunderhill-west");
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  });

  test("sim: pause menu item opens the sheet", async ({ page, isMobile }) => {
    await page.goto("/sim");
    await expect(page.locator('[data-sim-ready="1"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator("[data-sim-start]")).toBeEnabled();
    await tap(page, "[data-sim-start]", isMobile);
    await expect(page.locator(".sim")).toHaveAttribute("data-sim-phase", "drive");
    await tap(page, "[data-sim-pause]", isMobile);
    await expect(page.locator("[data-sim-menu]")).toBeVisible();
    const item = '[data-bug-report-open="sim"]';
    // The pause menu is a full overlay, so the pedals sit under it by design.
    await expectNoOverlap(page, item, ["[data-sim-pause]"]);
    await checkSheet(page, item, isMobile, "/sim");
    await expect(page.locator("[data-sim-menu]")).toBeVisible();
  });
});
