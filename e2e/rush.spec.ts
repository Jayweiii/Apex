import { expect, test, type Page } from "@playwright/test";

/**
 * Apex Rush: 3D pixel kart racing on the site's real circuits. These run at
 * iPhone size (touch) and desktop: the menu and garage work on one tap, a race
 * starts and the kart moves, the one-thumb stick steers and drifts, and a
 * time trial shows the real-lap ghost timing.
 */
const canvas = (page: Page) => page.locator("[data-rush-canvas]");
const num = async (page: Page, name: string) => Number((await canvas(page).getAttribute(`data-rush-${name}`)) ?? 0);

async function openMenu(page: Page, query = "") {
  await page.goto(`/rush${query}`);
  await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
}

async function activate(page: Page, selector: string, isMobile: boolean) {
  const el = page.locator(selector);
  if (isMobile) await el.tap();
  else await el.click();
}

test.describe("Apex Rush", () => {
  test("menu: tracks, mode and garage respond to one tap and are saved", async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await openMenu(page);

    // Four real circuits.
    await expect(page.locator("[data-rush-track]")).toHaveCount(4);
    await activate(page, '[data-rush-track="streets-of-willow-cw"]', isMobile);
    await expect(page.locator('[data-rush-track="streets-of-willow-cw"]')).toHaveAttribute("aria-checked", "true");
    await activate(page, '[data-rush-mode="tt"]', isMobile);
    await expect(page.locator('[data-rush-mode="tt"]')).toHaveAttribute("aria-pressed", "true");

    // Garage: pick a body, wheels and paint.
    await activate(page, '[data-rush-tab="garage"]', isMobile);
    await activate(page, '[data-rush-body="buggy"]', isMobile);
    await expect(page.locator('[data-rush-body="buggy"]')).toHaveAttribute("aria-checked", "true");
    await activate(page, '[data-rush-wheels="drift"]', isMobile);
    await expect(page.locator('[data-rush-wheels="drift"]')).toHaveAttribute("aria-checked", "true");

    // Every tap target is at least 44 px.
    for (const sel of ["[data-rush-tab]", "[data-rush-body]", "[data-rush-wheels]", ".rush-swatch"]) {
      const boxes = await page.locator(sel).evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
      for (const [w, h] of boxes) {
        expect(w, `${sel} width`).toBeGreaterThanOrEqual(44);
        expect(h, `${sel} height`).toBeGreaterThanOrEqual(44);
      }
    }

    // Choices survive a reload.
    await page.reload();
    await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('[data-rush-track="streets-of-willow-cw"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator('[data-rush-mode="tt"]')).toHaveAttribute("aria-pressed", "true");
    await activate(page, '[data-rush-tab="garage"]', isMobile);
    await expect(page.locator('[data-rush-body="buggy"]')).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });

  test("a race starts on one tap, counts down, and the kart drives in 3D", async ({ page, isMobile }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // ?auto=1: the kart drives itself, so this checks the whole loop without input timing.
    await openMenu(page, "?auto=1");
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toBeVisible({ timeout: 60_000 });

    // The clock does not run before GO.
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown/, { timeout: 30_000 });
    expect(await num(page, "tick")).toBe(0);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 30_000 });

    // The sim keeps up with real time and the kart gets going.
    const t0 = Date.now();
    const tick0 = await num(page, "tick");
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(12);
    await page.waitForTimeout(3000);
    const rate = ((await num(page, "tick")) - tick0) / ((Date.now() - t0) / 1000);
    expect(rate, "sim ticks per second").toBeGreaterThan(40);

    // A real WebGL frame was drawn at a chunky-pixel resolution.
    const res = (await canvas(page).getAttribute("data-rush-res")) ?? "";
    const [w, h] = res.split("x").map(Number);
    expect(w).toBeGreaterThan(100);
    expect(h).toBeGreaterThan(100);
    const css = await canvas(page).evaluate((el) => el.getBoundingClientRect().width);
    expect(css / w!, "CSS px per game pixel").toBeGreaterThanOrEqual(1.9);
    expect(await num(page, "tris")).toBeGreaterThan(10_000);

    // The canvas fills the screen and the page cannot scroll.
    const fill = await page.evaluate(() => {
      const r = document.querySelector("[data-rush-canvas]")!.getBoundingClientRect();
      return { w: r.width / window.innerWidth, h: r.height / window.innerHeight, scroll: document.documentElement.scrollHeight - window.innerHeight };
    });
    expect(fill.w).toBeGreaterThan(0.97);
    expect(fill.h).toBeGreaterThan(0.97);
    expect(fill.scroll).toBeLessThanOrEqual(1);

    // Pause and nitro are real tap targets; pause stops the clock; quit returns to the menu.
    for (const sel of ["[data-rush-pause]", "[data-rush-nitro]"]) {
      const box = await page.locator(sel).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await activate(page, "[data-rush-pause]", isMobile);
    await expect(page.locator("[data-rush-paused]")).toBeVisible();
    const pausedAt = await num(page, "tick");
    await page.waitForTimeout(700);
    expect(await num(page, "tick")).toBe(pausedAt);
    await activate(page, "[data-rush-resume]", isMobile);
    await expect.poll(() => num(page, "tick"), { timeout: 10_000 }).toBeGreaterThan(pausedAt + 20);
    await activate(page, "[data-rush-pause]", isMobile);
    await activate(page, "[data-rush-quit]", isMobile);
    await expect(page.locator("[data-rush-menu]")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("one-thumb stick: drag steers, the edge drifts, letting go ends the drift", async ({ page, isMobile }) => {
    await openMenu(page);
    await activate(page, '[data-rush-track="buttonwillow-13cw"]', isMobile);
    await activate(page, '[data-rush-mode="tt"]', isMobile);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });

    // Pointer events drive the stick for touch and mouse alike.
    const box = (await page.locator("[data-rush-surface]").boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    const surface = page.locator("[data-rush-surface]");
    const fire = (type: string, px: number, py: number) =>
      surface.dispatchEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: px, clientY: py, bubbles: true });
    await fire("pointerdown", x, y);
    // Holding the stick is the gas.
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(13);
    expect(await num(page, "drift")).toBe(0);
    // Push to the right edge: drift.
    await fire("pointermove", x + 70, y);
    await expect.poll(() => num(page, "drift"), { timeout: 5_000 }).toBe(1);
    // Let go: the drift ends.
    await fire("pointerup", x + 70, y);
    await expect.poll(() => num(page, "drift"), { timeout: 5_000 }).toBe(0);
  });

  /**
   * Start a fresh Buttonwillow 13CW time trial, get moving, then steer one way
   * (or not at all) and return a reader for the heading change since the steer
   * began. Callers assert on the turn itself, early, while the kart is still on
   * the start straight: a fixed window can run into the wall, which swings the
   * kart back along the track and hides the steering.
   */
  async function steerFromStart(page: Page, isMobile: boolean, via: "stick" | "keys", dir: -1 | 0 | 1) {
    await openMenu(page);
    await activate(page, '[data-rush-track="buttonwillow-13cw"]', isMobile);
    await activate(page, '[data-rush-mode="tt"]', isMobile);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    const surface = page.locator("[data-rush-surface]");
    const box = (await surface.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    const fire = (type: string, px: number) =>
      surface.dispatchEvent(type, { pointerId: 8, pointerType: isMobile ? "touch" : "mouse", isPrimary: true, clientX: px, clientY: y, bubbles: true });
    // 44 px is ~0.76 of the stick radius: a firm turn, short of the drift edge.
    const off = dir * 44;
    if (via === "stick") await fire("pointerdown", x);
    else await page.keyboard.down("ArrowUp");
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(6);
    const h0 = await num(page, "heading");
    if (via === "stick") await fire("pointermove", x + off);
    else if (dir !== 0) await page.keyboard.down(dir < 0 ? "ArrowLeft" : "ArrowRight");
    return async () => {
      const h = await num(page, "heading");
      return Math.atan2(Math.sin(h - h0), Math.cos(h - h0));
    };
  }

  // Game headings are counter-clockwise from east: a left turn increases the heading.
  for (const via of ["stick", "keys"] as const) {
    test(`${via === "stick" ? "dragging" : "arrow keys"}: screen-left turns the heading left, screen-right right`, async ({ page, isMobile }) => {
      test.skip(via === "keys" && isMobile, "no keyboard on the phone profile");
      test.setTimeout(300_000); // three fresh races

      // No steering: the kart holds its heading down the start straight.
      const centred = await steerFromStart(page, isMobile, via, 0);
      await page.waitForTimeout(400);
      expect(Math.abs(await centred()), "heading change with no steering").toBeLessThan(0.05);

      const left = await steerFromStart(page, isMobile, via, -1);
      await expect.poll(left, { timeout: 4_000, intervals: [50] }).toBeGreaterThan(0.3);

      const right = await steerFromStart(page, isMobile, via, 1);
      await expect.poll(right, { timeout: 4_000, intervals: [50] }).toBeLessThan(-0.3);
    });
  }

  test("after garage changes and a long scroll, the stick appears and drives", async ({ page, isMobile }) => {
    await openMenu(page);
    await activate(page, '[data-rush-tab="garage"]', isMobile);
    await activate(page, '[data-rush-body="bubble"]', isMobile);
    await activate(page, '[data-rush-wheels="chunky"]', isMobile);
    await activate(page, ".rush-swatch >> nth=27", isMobile);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await activate(page, '[data-rush-tab="race"]', isMobile);
    await page.locator("[data-rush-start]").scrollIntoViewIfNeeded();
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    // The race starts from the top of the page.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const surface = page.locator("[data-rush-surface]");
    const box = (await surface.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    // The touch lands on the play surface, not on something above it.
    expect(await page.evaluate(([px, py]) => document.elementFromPoint(px!, py!)?.closest("[data-rush-surface]") !== null, [x, y])).toBe(true);
    await surface.dispatchEvent("pointerdown", { pointerId: 11, pointerType: isMobile ? "touch" : "mouse", isPrimary: true, clientX: x, clientY: y, bubbles: true });
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(10);
    await surface.dispatchEvent("pointerup", { pointerId: 11, pointerType: isMobile ? "touch" : "mouse", isPrimary: true, clientX: x, clientY: y, bubbles: true });
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "0");
  });

  test("touch events alone drive the stick (fallback when no pointer events arrive)", async ({ page, isMobile }) => {
    test.skip(!isMobile, "needs touch support");
    await openMenu(page);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    const touch = (type: string, dx: number) =>
      page.evaluate(
        ([kind, off]) => {
          const el = document.querySelector("[data-rush-surface]") as HTMLElement;
          const r = el.getBoundingClientRect();
          const t = new Touch({ identifier: 3, target: el, clientX: r.left + r.width / 2 + (off as number), clientY: r.top + r.height * 0.8 });
          const ended = kind === "touchend";
          el.dispatchEvent(new TouchEvent(kind as string, { touches: ended ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        },
        [type, dx],
      );
    await touch("touchstart", 0);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(10);
    const h0 = await num(page, "heading");
    await touch("touchmove", -45);
    await expect.poll(async () => (await num(page, "heading")) - h0, { timeout: 4_000 }).toBeGreaterThan(0.2);
    await touch("touchend", -45);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "0");
  });

  test("?debug=1 shows the touch log; hidden by default", async ({ page, isMobile }) => {
    await openMenu(page, "?debug=1");
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    await expect(page.locator("[data-rush-debug]")).toBeVisible();
    await expect(page.locator("[data-rush-debug]")).toContainText("stick");
    await page.goto("/rush");
    await expect(page.locator("[data-rush-menu]")).toBeVisible({ timeout: 90_000 });
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-rush-debug]")).toBeHidden();
  });

  test("restarting a race frees its WebGL context", async ({ page, isMobile }) => {
    await page.addInitScript(() => {
      const made: Array<WebGLRenderingContext | WebGL2RenderingContext> = [];
      (window as unknown as { __rushGl: typeof made }).__rushGl = made;
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        const ctx = (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
        if (ctx && (type === "webgl" || type === "webgl2") && !made.includes(ctx as WebGLRenderingContext)) made.push(ctx as WebGLRenderingContext);
        return ctx;
      } as typeof orig;
    });
    await openMenu(page, "?auto=1");
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    for (let i = 0; i < 6; i += 1) {
      await activate(page, "[data-rush-pause]", isMobile);
      await activate(page, "[data-rush-restart]", isMobile);
      await expect(page.locator("[data-rush-paused]")).toHaveCount(0);
      await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 30_000 });
    }
    const live = await page.evaluate(() => (window as unknown as { __rushGl: WebGLRenderingContext[] }).__rushGl.filter((gl) => !gl.isContextLost()).length);
    expect(live, "live WebGL contexts after 6 restarts").toBeLessThanOrEqual(2);
  });
});
