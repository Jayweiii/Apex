import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

/**
 * Apex Rush online: two real players (two browser contexts) over the site's
 * Supabase Realtime. One creates a lobby, the other joins by invite link,
 * they see each other, the host picks the track and starts, and each sees the
 * other's kart move in the race. Also: a bad code is refused, and a player who
 * leaves disappears from the race.
 */
const canvas = (page: Page) => page.locator("[data-rush-canvas]");
const num = async (page: Page, name: string) => Number((await canvas(page).getAttribute(`data-rush-${name}`)) ?? 0);

async function activate(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector);
  if (isMobile) await el.tap();
  else await el.click();
}

/** A second player on the same kind of device as this project. */
async function secondPlayer(browser: Browser, info: TestInfo): Promise<Page> {
  const use = info.project.use;
  const ctx = await browser.newContext({
    baseURL: use.baseURL,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
  });
  return ctx.newPage();
}

async function createLobby(page: Page, isMobile: boolean, query = ""): Promise<string> {
  await page.goto(`/rush${query}`);
  await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
  await activate(page, '[data-rush-mode="online"]', isMobile);
  await page.locator("[data-rush-name]").fill("HOSTY");
  await activate(page, "[data-rush-create]", isMobile);
  const code = page.locator("[data-rush-lobby-code]");
  await expect(code).toBeVisible({ timeout: 30_000 });
  return (await code.textContent())!.trim();
}

test.describe("Apex Rush online", () => {
  test.setTimeout(240_000);

  test("a bad code is refused with a clear message", async ({ page, isMobile }) => {
    await page.goto("/rush");
    await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
    await activate(page, '[data-rush-mode="online"]', isMobile);
    await page.locator("[data-rush-join-code]").fill("K7");
    await activate(page, "[data-rush-join]", isMobile);
    await expect(page.locator("[data-rush-online-error]")).toContainText("4 letters");
    // A well-formed code nobody is using.
    await page.locator("[data-rush-join-code]").fill("ZZ99");
    await activate(page, "[data-rush-join]", isMobile);
    await expect(page.locator("[data-rush-online-error]")).toContainText("No lobby with code ZZ99", { timeout: 30_000 });
    await expect(page.locator("[data-rush-lobby]")).toHaveCount(0);
  });

  test("create, join by link, pick a track, race each other, and leave", async ({ page, browser, isMobile }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const code = await createLobby(page, isMobile, "?auto=1");
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    await expect(page.locator("[data-rush-lobby-start]")).toBeDisabled();

    // The friend opens the invite link: the code is filled in and Join is one tap.
    const guest = await secondPlayer(browser, info);
    guest.on("pageerror", (e) => errors.push(e.message));
    await guest.goto(`/rush?lobby=${code}&auto=1`);
    await expect(guest.locator("[data-rush-join-code]")).toHaveValue(code, { timeout: 90_000 });
    await expect(guest.locator("[data-rush-lobby]")).toHaveCount(0);
    await activate(guest, "[data-rush-join]", isMobile);
    await expect(guest.locator(`[data-rush-lobby="${code}"]`)).toBeVisible({ timeout: 60_000 });
    await expect(guest.locator("[data-rush-players]")).toHaveAttribute("data-rush-players", "2", { timeout: 30_000 });
    await expect(page.locator("[data-rush-players]")).toHaveAttribute("data-rush-players", "2", { timeout: 30_000 });
    await expect(guest.locator("[data-rush-lobby-wait]")).toContainText("HOSTY");

    // Only the host picks the track; the guest sees the choice.
    await activate(page, '[data-rush-lobby-track="streets-of-willow-cw"]', isMobile);
    await expect(guest.locator("[data-rush-lobby-track-name]")).toContainText("STREETS OF WILLOW", { timeout: 20_000 });

    // Start: both race, each sees the other's kart.
    await activate(page, "[data-rush-lobby-start]", isMobile);
    for (const p of [page, guest]) await expect(canvas(p)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    for (const p of [page, guest]) await expect(canvas(p)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    for (const p of [page, guest]) await expect.poll(() => num(p, "remote"), { timeout: 30_000 }).toBe(1);
    // Both are moving (driven by the autopilot) and placed against each other.
    for (const p of [page, guest]) await expect.poll(() => num(p, "speed"), { timeout: 20_000 }).toBeGreaterThan(8);
    const places = [await num(page, "place"), await num(guest, "place")].sort();
    expect(places).toEqual([1, 2]);

    // The guest leaves: the host's race drops their kart.
    await guest.context().close();
    await expect.poll(() => num(page, "remote"), { timeout: 60_000 }).toBe(0);

    // Back in the lobby the host is alone again.
    await activate(page, "[data-rush-pause]", isMobile);
    await activate(page, "[data-rush-quit]", isMobile);
    await expect(page.locator("[data-rush-players]")).toHaveAttribute("data-rush-players", "1", { timeout: 30_000 });
    await activate(page, "[data-rush-lobby-leave]", isMobile);
    await expect(page.locator("[data-rush-menu]")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("lobby")).toBeNull();
    expect(errors).toEqual([]);
  });
});
