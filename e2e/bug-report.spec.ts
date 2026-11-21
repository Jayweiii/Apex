import { expect, test, type Page } from "@playwright/test";
import { DRIVE_TRACK } from "./fixtures";

/**
 * Bug report button: footer link on the site, a pause-menu item in each game,
 * a sheet with the note + auto context, and a mailto: link to Apex.
 */
const EMAIL = /jwei(%2B|\+)apexbug(%40|@)mail\.grokbot\.com/;

async function tap(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector).first();
  if (isMobile) await el.tap();
  else await el.click();
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Open the sheet from the pause menu, check it, and return to the menu. */
async function checkSheet(page: Page, isMobile: boolean, route: string, avoid: string[]) {
  const trigger = page.locator("[data-apex-bug-report]:visible").first();
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveText("Report a bug");
  const tb = (await trigger.boundingBox())!;
  expect(tb.height).toBeGreaterThanOrEqual(44);
  expect(tb.width).toBeGreaterThanOrEqual(44);
  // The menu item never sits on the stick or HUD controls.
  for (const sel of avoid) {
    for (const el of await page.locator(sel).all()) {
      const b = await el.boundingBox();
      if (b && (await el.isVisible())) expect(overlaps(tb, b), `${sel} overlaps Report a bug`).toBe(false);
    }
  }
  await trigger.scrollIntoViewIfNeeded();
  if (isMobile) await trigger.tap();
  else await trigger.click();

  const sheet = page.locator("[data-apex-bug-sheet]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("What went wrong?")).toBeVisible();
  const sb = (await sheet.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(sb.x).toBeGreaterThanOrEqual(0);
  expect(sb.x + sb.width).toBeLessThanOrEqual(vp.width + 1);
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height + 1);
  for (const sel of ["[data-apex-bug-email]", "[data-apex-bug-copy]", "[data-apex-bug-close]"]) {
    const b = (await page.locator(sel).boundingBox())!;
    expect(b.height, `${sel} height`).toBeGreaterThanOrEqual(44);
  }

  // Typing must not trigger game shortcuts (P pauses/resumes, WASD steer).
  await page.locator("[data-apex-bug-note]").fill("");
  await page.locator("[data-apex-bug-note]").pressSequentially("pwasd it broke");
  await expect(page.locator("[data-apex-bug-sheet]")).toBeVisible();

  const href = (await page.locator("[data-apex-bug-email]").getAttribute("href"))!;
  expect(href).toMatch(/^mailto:/);
  expect(href).toMatch(EMAIL);
  expect(href).toContain(encodeURIComponent(route));
  expect(href).toContain(encodeURIComponent("pwasd it broke"));
  expect(href.length).toBeLessThanOrEqual(1800);
  await expect(page.locator("[data-apex-bug-context]")).toContainText(route);

  await tap(page, "[data-apex-bug-close]", isMobile);
  await expect(sheet).toBeHidden();
  // Back on the pause menu.
  await expect(page.locator("[data-apex-bug-report]:visible").first()).toBeVisible();
}

test.describe("Bug report", () => {
  for (const path of ["/", "/definitely-not-a-page"]) {
    test(`site footer has Report a bug on ${path}`, async ({ page, isMobile }) => {
      await page.goto(path);
      const link = page.locator("footer [data-apex-bug-report]");
      await expect(link).toBeVisible({ timeout: 60_000 });
      await expect(link).toHaveText("Report a bug");
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (isMobile) await link.tap();
      else await link.click();
      await expect(page.locator("[data-apex-bug-sheet]")).toBeVisible();
      await page.locator("[data-apex-bug-note]").fill("footer note");
      const href = (await page.locator("[data-apex-bug-email]").getAttribute("href"))!;
      expect(href).toMatch(EMAIL);
      expect(href).toContain(encodeURIComponent(path));
      expect(href).toContain(encodeURIComponent("footer note"));
      await expect(page.locator("[data-apex-bug-context]")).not.toContainText(/cookie|token|supabase/i);
    });
  }

  test("long error logs are trimmed so the mailto stays short", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.locator("footer [data-apex-bug-report]")).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < 7; i += 1) {
      await page.evaluate((n) => window.dispatchEvent(new ErrorEvent("error", { message: `boom ${n} ${"x".repeat(300)}` })), i);
    }
    if (isMobile) await page.locator("footer [data-apex-bug-report]").tap();
    else await page.locator("footer [data-apex-bug-report]").click();
    await page.locator("[data-apex-bug-note]").fill("n".repeat(500));
    const href = (await page.locator("[data-apex-bug-email]").getAttribute("href"))!;
    expect(href.length).toBeLessThanOrEqual(1800);
    await expect(page.locator("[data-apex-bug-context]")).toContainText("boom 6");
    await expect(page.locator("[data-apex-bug-context]")).not.toContainText("boom 1 ");
  });

  test("Rush pause menu", async ({ page, isMobile }) => {
    await page.goto("/rush?auto=1");
    await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-rush-start]", isMobile);
    await expect(page.locator("[data-rush-canvas]")).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    await tap(page, "[data-rush-pause]", isMobile);
    await expect(page.locator("[data-rush-paused]")).toBeVisible();
    await checkSheet(page, isMobile, "/rush", [".rush-stick", "[data-rush-pause]", "[data-rush-nitro]"]);
    await expect(page.locator("[data-rush-paused]")).toBeVisible();
  });

  test("Kart pause menu", async ({ page, isMobile }) => {
    await page.goto("/kart");
    await expect(page.locator("[data-apex-kart-start]")).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-apex-kart-start]", isMobile);
    await expect(page.locator("[data-apex-kart]")).toHaveAttribute("data-phase", "racing", { timeout: 15_000 });
    await tap(page, "[data-apex-kart-pause]", isMobile);
    await expect(page.locator("[data-apex-kart]")).toHaveAttribute("data-phase", "paused");
    await checkSheet(page, isMobile, "/kart", ["[data-apex-kart-stick]", "[data-apex-kart-control]", "[data-apex-kart-pause]"]);
    await expect(page.locator("[data-apex-kart]")).toHaveAttribute("data-phase", "paused");
  });

  test("Kart2 pause menu", async ({ page, isMobile }) => {
    await page.goto("/kart2");
    await expect(page.locator("[data-apex-kart2-start]")).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-apex-kart2-start]", isMobile);
    await expect(page.locator("[data-apex-kart2]")).toHaveAttribute("data-phase", "racing", { timeout: 15_000 });
    await tap(page, "[data-apex-kart2-pause]", isMobile);
    await expect(page.locator("[data-apex-kart2]")).toHaveAttribute("data-phase", "paused");
    await checkSheet(page, isMobile, "/kart2", ["[data-apex-kart2-stick]", "[data-apex-kart2-pause]"]);
    await expect(page.locator("[data-apex-kart2]")).toHaveAttribute("data-phase", "paused");
  });

  test("Drive pause menu", async ({ page, isMobile }) => {
    await page.goto(`/drive/${DRIVE_TRACK}`);
    const start = page.locator("[data-apex-drive-start]");
    await expect(start).toBeVisible({ timeout: 90_000 });
    await tap(page, "[data-apex-drive-start]", isMobile);
    const pause = page.getByRole("button", { name: "Pause", exact: true });
    await expect(pause).toBeVisible({ timeout: 30_000 });
    // Pause only works once the countdown ends: retry the tap until it lands.
    await expect(async () => {
      if (isMobile) await pause.tap();
      else await pause.click();
      await expect(page.getByText("Paused", { exact: true })).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 30_000 });
    await checkSheet(page, isMobile, `/drive/${DRIVE_TRACK}`, ["[data-apex-drive-touch-pads] *"]);
    await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  });
});
