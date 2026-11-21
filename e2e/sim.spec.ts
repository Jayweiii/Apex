import { expect, test, type Page } from "@playwright/test";

/**
 * Apex Sim: an ND Miata on Thunderhill West at full scale. At iPhone size
 * (touch) and desktop: the menu's choices respond to one tap and persist, the
 * car drives from the pedals, and crossing the line starts the lap with the
 * real-lap ghost and a live gap to it.
 */
const root = (page: Page) => page.locator(".sim");
const num = async (page: Page, name: string) => Number((await root(page).getAttribute(`data-sim-${name}`)) ?? 0);

async function open(page: Page, query = "") {
  await page.goto(`/sim${query}`);
  await expect(page.locator('[data-sim-ready="1"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("[data-sim-start]")).toBeEnabled();
}

async function activate(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector);
  if (isMobile) await el.tap();
  else await el.click();
}

test.describe("Apex Sim", () => {
  test("menu: real lap shown, choices respond to one tap and are saved", async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    await expect(page.locator("[data-sim-reallap]")).toHaveText("1:34.801");

    const tc = '[data-sim-toggle="tc"]';
    await expect(page.locator(tc)).toHaveAttribute("aria-pressed", "true");
    await activate(page, tc, isMobile);
    await expect(page.locator(tc)).toHaveAttribute("aria-pressed", "false");
    await activate(page, '[data-sim-toggle="ghost-best"]', isMobile);
    await expect(page.locator('[data-sim-toggle="ghost-best"]')).toHaveAttribute("aria-pressed", "false");

    // Every tap target is at least 44 px.
    for (const sel of [".sim-toggle", ".sim-swatch", "[data-sim-start]", "[data-sim-exit]"]) {
      const boxes = await page.locator(sel).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
      for (const [w, h] of boxes) expect(Math.min(w!, h!), `${sel} is a 44 px target`).toBeGreaterThanOrEqual(44);
    }

    await page.reload();
    await expect(page.locator('[data-sim-ready="1"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator(tc)).toHaveAttribute("aria-pressed", "false");
    expect(errors).toEqual([]);
  });

  test("a tap presses once: first tap works, the browser's own click does not press it again", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch only");
    await open(page);
    const tc = page.locator('[data-sim-toggle="tc"]');
    const before = await tc.getAttribute("aria-pressed");
    await tc.scrollIntoViewIfNeeded();
    const box = (await tc.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const at = { pointerId: 61, pointerType: "touch", isPrimary: true, clientX: cx, clientY: cy, bubbles: true };
    // Down and up with no click of its own (iOS taking the tap as a hover): it still toggles.
    await tc.dispatchEvent("pointerdown", at);
    await tc.dispatchEvent("pointerup", at);
    // The browser's click for that same tap, right behind it: ignored, no double toggle.
    await page.mouse.click(cx, cy);
    const after = before === "true" ? "false" : "true";
    await page.waitForTimeout(300);
    await expect(tc).toHaveAttribute("aria-pressed", after);
    // A real later tap still works.
    await page.waitForTimeout(800);
    await tc.tap();
    await expect(tc).toHaveAttribute("aria-pressed", before!);
  });

  test("driving: the pedals move the car, pause stops it", async ({ page, isMobile }) => {
    await open(page, "?simSpeed=16");
    await activate(page, "[data-sim-start]", isMobile);
    await expect(root(page)).toHaveAttribute("data-sim-phase", "drive");
    await expect(page.locator("[data-sim-menu]")).toHaveCount(0);

    if (isMobile) {
      await expect(page.locator("[data-sim-steerpad]")).toBeVisible();
      await page.locator("[data-sim-gas]").dispatchEvent("pointerdown", { pointerId: 7, bubbles: true });
    } else await page.keyboard.down("ArrowUp");
    await expect.poll(() => num(page, "speed"), { timeout: 60_000 }).toBeGreaterThan(20);
    expect(await num(page, "off")).toBe(0);
    if (isMobile) await page.locator("[data-sim-gas]").dispatchEvent("pointerup", { pointerId: 7, bubbles: true });
    else await page.keyboard.up("ArrowUp");

    // Pause freezes the car; resume carries on.
    await activate(page, "[data-sim-pause]", isMobile);
    await expect(root(page)).toHaveAttribute("data-sim-phase", "paused");
    await page.waitForTimeout(1500);
    const s0 = await num(page, "s");
    await page.waitForTimeout(1500);
    expect(await num(page, "s")).toBe(s0);
    await activate(page, "[data-sim-start]", isMobile);
    await expect(root(page)).toHaveAttribute("data-sim-phase", "drive");
  });

  test("touch: holding gas for 3 s keeps accelerating (no pointercancel cut)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch pedals only exist on the iPhone project");
    await open(page);
    await activate(page, "[data-sim-start]", isMobile);
    await expect(root(page)).toHaveAttribute("data-sim-phase", "drive");
    const gas = page.locator("[data-sim-gas]");
    const box = (await gas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const point = [{ x: cx, y: cy, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
    await page.waitForTimeout(1500);
    const v1 = await num(page, "speed");
    await page.waitForTimeout(2000);
    const v2 = await num(page, "speed");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(v1).toBeGreaterThan(0);
    expect(v2).toBeGreaterThan(v1);
  });

  test("lap: crossing the line starts the clock, the real-lap ghost and the gap", async ({ page, isMobile }) => {
    await open(page, "?autopilot=1&simSpeed=32&runUp=40");
    await activate(page, "[data-sim-start]", isMobile);
    await expect.poll(() => num(page, "lap"), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => num(page, "lap-ms"), { timeout: 30_000 }).toBeGreaterThan(1500);
    await expect(root(page)).toHaveAttribute("data-sim-ghosts", /real/);
    await expect(page.locator("[data-sim-delta]")).toHaveText(/[+−]\d+\.\d\d s vs real lap/);
    await expect(page.locator("[data-sim-laptime]")).toHaveText(/^0:\d\d\.\d{3}$/);
    expect(await num(page, "valid")).toBe(1);
  });
});
