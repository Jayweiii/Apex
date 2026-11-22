import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

/**
 * Apex Sim online races: two real drivers (two browser contexts) over the
 * site's Supabase Realtime. One creates a lobby, the other joins from the
 * invite link with one tap, they see each other with their own paints, the
 * host picks the race length and starts, both get the lights and race with
 * the other car on track, and a driver who leaves drops out. Also: a bad code
 * is refused, and a short race runs to the finish and the results.
 * Cars drive themselves (?autopilot=1) so the race is the same every run, and
 * draw only every few frames (?drawEvery) so two 3D views share one machine.
 */
const root = (page: Page) => page.locator("[data-sim-phase]");
const num = async (page: Page, name: string) => Number((await root(page).getAttribute(`data-sim-${name}`)) ?? 0);

async function activate(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector);
  if (isMobile) await el.tap();
  else await el.click();
}

async function open(page: Page, query: string) {
  await page.goto(`/sim${query}`);
  await expect(page.locator('[data-sim-ready="1"]')).toBeVisible({ timeout: 90_000 });
}

async function secondDriver(browser: Browser, info: TestInfo): Promise<Page> {
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

async function createLobby(page: Page, isMobile: boolean, query: string): Promise<string> {
  await open(page, query);
  await page.locator("[data-sim-name]").fill("HOSTY");
  await activate(page, "[data-sim-create]", isMobile);
  const code = page.locator("[data-sim-lobby-code]");
  await expect(code).toBeVisible({ timeout: 30_000 });
  return (await code.textContent())!.trim();
}

async function joinByLink(guest: Page, code: string, isMobile: boolean, query = "") {
  await open(guest, `?lobby=${code}${query}`);
  // The invite fills in the code; Join is one tap (the tap iOS needs for sound).
  await expect(guest.locator("[data-sim-join-code]")).toHaveValue(code);
  await expect(guest.locator("[data-sim-lobby]")).toHaveCount(0);
  await activate(guest, "[data-sim-join]", isMobile);
  await expect(guest.locator(`[data-sim-lobby="${code}"]`)).toBeVisible({ timeout: 60_000 });
}

test.describe("Apex Sim online", () => {
  test.setTimeout(300_000);

  test("a bad code is refused with a clear message", async ({ page, isMobile }) => {
    await open(page, "");
    await page.locator("[data-sim-join-code]").fill("K7");
    await activate(page, "[data-sim-join]", isMobile);
    await expect(page.locator("[data-sim-online-error]")).toContainText("4 letters");
    await page.locator("[data-sim-join-code]").fill("ZZ99");
    await activate(page, "[data-sim-join]", isMobile);
    await expect(page.locator("[data-sim-online-error]")).toContainText("No lobby with code ZZ99", { timeout: 30_000 });
    await expect(page.locator("[data-sim-lobby]")).toHaveCount(0);
  });

  test("create, join by link, pick the laps, race from the grid, and leave", async ({ page, browser, isMobile }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const code = await createLobby(page, isMobile, "?autopilot=1&drawEvery=3");
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    await expect(page.locator("[data-sim-lobby-start]")).toBeDisabled();

    const guest = await secondDriver(browser, info);
    guest.on("pageerror", (e) => errors.push(e.message));
    await joinByLink(guest, code, isMobile, "&autopilot=1&drawEvery=12");
    for (const p of [page, guest]) await expect(p.locator("[data-sim-players]")).toHaveAttribute("data-sim-players", "2", { timeout: 30_000 });
    await expect(guest.locator("[data-sim-lobby-wait]")).toContainText("HOSTY");
    // Both on the default paint, yet each car has its own, the same on both screens.
    const paints = (p: Page) => p.locator("[data-sim-player]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sim-paint")));
    const hostPaints = await paints(page);
    expect(new Set(hostPaints).size).toBe(2);
    expect(await paints(guest)).toEqual(hostPaints);

    // Only the host picks the race length; the guest sees it.
    await activate(page, '[data-sim-laps="5"]', isMobile);
    await expect(guest.locator("[data-sim-laps-shown]")).toContainText("5 laps", { timeout: 20_000 });

    // Start: both line up on the grid, get the lights, and race with the other car on track.
    await activate(page, "[data-sim-lobby-start]", isMobile);
    for (const p of [page, guest]) await expect(root(p)).toHaveAttribute("data-sim-race", /grid|racing/, { timeout: 30_000 });
    for (const p of [page, guest]) await expect(root(p)).toHaveAttribute("data-sim-race", "racing", { timeout: 30_000 });
    for (const p of [page, guest]) await expect.poll(() => num(p, "remote"), { timeout: 30_000 }).toBe(1);
    for (const p of [page, guest]) await expect.poll(() => num(p, "speed"), { timeout: 30_000 }).toBeGreaterThan(5);
    const places = [await num(page, "place"), await num(guest, "place")].sort();
    expect(places).toEqual([1, 2]);
    await expect(page.locator("[data-sim-racebox]")).toContainText(/Lap 1\/5/);

    // The guest leaves: after a short grace the host's race drops their car.
    await guest.context().close();
    await expect.poll(() => num(page, "remote"), { timeout: 60_000 }).toBe(0);

    // Leave the race: back in the lobby, alone; leave the lobby: the menu, join field empty.
    await activate(page, "[data-sim-pause]", isMobile);
    await activate(page, "[data-sim-race-leave]", isMobile);
    await expect(page.locator("[data-sim-players]")).toHaveAttribute("data-sim-players", "1", { timeout: 30_000 });
    await activate(page, "[data-sim-lobby-leave]", isMobile);
    await expect(page.locator("[data-sim-create]")).toBeVisible();
    await expect(page.locator("[data-sim-join-code]")).toHaveValue("");
    expect(new URL(page.url()).searchParams.get("lobby")).toBeNull();
    expect(errors).toEqual([]);
  });

  test("a race runs to the finish: results for both, then back to the lobby", async ({ page, browser, isMobile }, info) => {
    test.skip(isMobile, "one finish run is enough; the phone project covers the race start above");
    // Sped-up physics (?simSpeed) so three laps take seconds, not minutes.
    const code = await createLobby(page, isMobile, "?autopilot=1&simSpeed=64&drawEvery=6");
    const guest = await secondDriver(browser, info);
    await joinByLink(guest, code, isMobile, "&autopilot=1&simSpeed=64&drawEvery=12");
    await expect(page.locator("[data-sim-players]")).toHaveAttribute("data-sim-players", "2", { timeout: 30_000 });
    await activate(page, "[data-sim-lobby-start]", isMobile);
    for (const p of [page, guest]) await expect(root(p)).toHaveAttribute("data-sim-race", "finished", { timeout: 200_000 });
    for (const p of [page, guest]) {
      const rows = p.locator("[data-sim-standings] li");
      await expect(rows).toHaveCount(2);
      // Both finished: a winning time and a gap, no one still racing.
      await expect(p.locator("[data-sim-standings]")).not.toContainText("Racing…", { timeout: 30_000 });
      await expect(rows.first()).toContainText(/\d:\d\d\.\d{3}/);
      await expect(rows.nth(1)).toContainText(/\+\d+\.\d{3} s/);
    }
    await activate(page, "[data-sim-lobby-back]", isMobile);
    await expect(page.locator(`[data-sim-lobby="${code}"]`)).toBeVisible();
    await expect(page.locator("[data-sim-lobby-start]")).toBeVisible();
    await guest.context().close();
  });
});
