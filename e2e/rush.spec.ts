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

  test("tilt: turning the phone steers, held level it drives straight", async ({ page, isMobile }) => {
    await openMenu(page);
    if (!isMobile) {
      // No motion sensor on a desktop: no tilt choice.
      await expect(page.locator('[data-rush-steer="tilt"]')).toHaveCount(0);
      return;
    }
    test.setTimeout(240_000);
    // Newer Chromium asks for motion access the way iPhones do: this phone allows it.
    await page.context().grantPermissions(["accelerometer", "gyroscope", "magnetometer"]);
    await activate(page, '[data-rush-steer="tilt"]', isMobile);
    await expect(page.locator('[data-rush-steer="tilt"]')).toHaveAttribute("aria-pressed", "true");
    // The phone: a steady stream of orientation readings, gamma set per step.
    await page.evaluate(() => {
      const w = window as Window & { __gamma?: number };
      w.__gamma = 0;
      setInterval(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 40, gamma: w.__gamma })), 30);
    });
    const setGamma = (g: number) => page.evaluate((v) => ((window as Window & { __gamma?: number }).__gamma = v), g);

    for (const dir of [1, -1] as const) {
      await setGamma(0);
      if (dir === -1) {
        // A fresh race from the menu: the choice was saved.
        await activate(page, "[data-rush-pause]", isMobile);
        await activate(page, "[data-rush-quit]", isMobile);
        await expect(page.locator('[data-rush-steer="tilt"]')).toHaveAttribute("aria-pressed", "true");
      } else {
        await activate(page, '[data-rush-track="buttonwillow-13cw"]', isMobile);
        await activate(page, '[data-rush-mode="tt"]', isMobile);
      }
      await activate(page, "[data-rush-start]", isMobile);
      await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
      await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(6);
      const h0 = await num(page, "heading");
      if (dir === 1) {
        await page.waitForTimeout(400);
        expect(Math.abs(await num(page, "heading") - h0), "held level: straight").toBeLessThan(0.05);
      }
      const turned = async () => {
        const h = await num(page, "heading");
        return Math.atan2(Math.sin(h - h0), Math.cos(h - h0));
      };
      // Right edge down steers right (heading falls); left edge down, left.
      await setGamma(dir * 14);
      // 14° at a 40° hold is about 0.42 of full lock.
      await expect.poll(async () => dir * (await num(page, "steer")), { timeout: 3_000 }).toBeGreaterThan(0.35);
      if (dir === 1) await expect.poll(turned, { timeout: 4_000, intervals: [50] }).toBeLessThan(-0.3);
      else await expect.poll(turned, { timeout: 4_000, intervals: [50] }).toBeGreaterThan(0.3);
    }

    // Holding the screen while tilted drifts that way; letting go ends it.
    const surface = page.locator("[data-rush-surface]");
    const box = (await surface.boundingBox())!;
    const press = (type: string) =>
      surface.dispatchEvent(type, { pointerId: 9, pointerType: "touch", isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height * 0.7, bubbles: true });
    await press("pointerdown");
    await expect.poll(() => num(page, "drift"), { timeout: 3_000 }).toBe(-1);
    await press("pointerup");
    await expect.poll(() => num(page, "drift"), { timeout: 3_000 }).toBe(0);
  });

  test("tilt with auto gas off: the kart still drives forward", async ({ page, isMobile }) => {
    await openMenu(page);
    test.skip(!isMobile, "tilt is a phone control");
    test.setTimeout(240_000);
    await page.context().grantPermissions(["accelerometer", "gyroscope", "magnetometer"]);
    await activate(page, '[data-rush-steer="tilt"]', isMobile);
    await page.evaluate(() => setInterval(() => window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: 0, beta: 40, gamma: 0 })), 30));
    await activate(page, '[data-rush-track="buttonwillow-13cw"]', isMobile);
    await activate(page, '[data-rush-mode="tt"]', isMobile);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    await activate(page, "[data-rush-pause]", isMobile);
    await activate(page, '[data-rush-gas="manual"]', isMobile);
    await activate(page, "[data-rush-resume]", isMobile);
    // No thumb on the screen and no auto gas: tilt mode still accelerates.
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(6);
    // The bug report says how the kart was being driven.
    await activate(page, "[data-rush-pause]", isMobile);
    await activate(page, "[data-bug-report-open=rush]", isMobile);
    await expect(page.getByRole("dialog")).toContainText(/tilt, auto gas off, solo, phase paused, stick free, tilt live, last event/);
  });

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

  test("a press that lands off the surface during intro still takes the stick and steers", async ({ page, isMobile }) => {
    await openMenu(page);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    const surface = page.locator("[data-rush-surface]");
    const box = (await surface.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    const ev = (px: number) => ({ pointerId: 31, pointerType: isMobile ? "touch" : "mouse", isPrimary: true, clientX: px, clientY: y, bubbles: true });
    // The press lands on a layer above the surface (like a vanishing overlay).
    await page.locator("[data-rush-canvas]").dispatchEvent("pointerdown", ev(x));
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    // The same pointer then moves over the surface.
    await surface.dispatchEvent("pointermove", ev(x - 44));
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    await expect.poll(async () => Math.abs(await num(page, "steer")), { timeout: 5_000 }).toBeGreaterThan(0.3);
    await surface.dispatchEvent("pointerup", ev(x - 44));
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "0");
  });

  test("a press whose finger-up never arrived does not block the next press", async ({ page, isMobile }) => {
    await openMenu(page);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", /intro|countdown|racing/, { timeout: 60_000 });
    const surface = page.locator("[data-rush-surface]");
    const box = (await surface.boundingBox())!;
    const type = isMobile ? "touch" : "mouse";
    const at = (id: number, fx: number) => ({ pointerId: id, pointerType: type, isPrimary: true, clientX: box.x + box.width * fx, clientY: box.y + box.height * 0.75, bubbles: true });
    // A press, then its end is lost (iOS can swallow it).
    await surface.dispatchEvent("pointerdown", at(21, 0.3));
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    const leftA = await page.locator(".rush-stick").evaluate((el) => (el as HTMLElement).style.left);
    await page.waitForTimeout(300);
    // The next press, the only finger down, takes the stick where it lands.
    await surface.dispatchEvent("pointerdown", at(22, 0.7));
    await expect.poll(() => page.locator(".rush-stick").evaluate((el) => (el as HTMLElement).style.left)).not.toBe(leftA);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    // An up that lands somewhere other than the play surface still lets go.
    await page.locator("body").dispatchEvent("pointerup", at(22, 0.7));
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "0");
  });

  test("holding still: a cancelled pointer keeps the stick while the finger is down", async ({ page, isMobile }) => {
    test.skip(!isMobile, "needs touch support");
    await openMenu(page);
    await activate(page, "[data-rush-start]", isMobile);
    await expect(canvas(page)).toHaveAttribute("data-rush-phase", "racing", { timeout: 60_000 });
    // The same finger as both a pointer and a touch, as iOS sends it.
    const send = (kind: string, dx: number) =>
      page.evaluate(
        ([k, off]) => {
          const el = document.querySelector("[data-rush-surface]") as HTMLElement;
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2 + (off as number);
          const y = r.top + r.height * 0.8;
          if ((k as string).startsWith("pointer")) {
            el.dispatchEvent(new PointerEvent(k as string, { pointerId: 31, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true }));
            return;
          }
          const t = new Touch({ identifier: 4, target: el, clientX: x, clientY: y });
          const ended = k === "touchend";
          el.dispatchEvent(new TouchEvent(k as string, { touches: ended ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        },
        [kind, dx],
      );
    await send("pointerdown", 0);
    await send("touchstart", 0);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    await expect.poll(() => num(page, "speed"), { timeout: 15_000 }).toBeGreaterThan(10);
    // iOS's long-press gesture cancels the pointer; the thumb has not lifted.
    await send("pointercancel", 0);
    await page.waitForTimeout(300);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "1");
    // The stick keeps following the finger, now through its touches.
    const h0 = await num(page, "heading");
    await send("touchmove", -45);
    await expect.poll(async () => (await num(page, "heading")) - h0, { timeout: 4_000 }).toBeGreaterThan(0.2);
    // Lifting the finger lets go.
    await send("touchend", -45);
    await expect(page.locator(".rush-stick")).toHaveCSS("opacity", "0");
  });

  test("buttons press on the first tap even when the browser drops the click", async ({ page, isMobile }) => {
    test.skip(!isMobile, "touch only");
    await openMenu(page);
    const mode = page.locator('[data-rush-mode="tt"]');
    await expect(mode).toHaveAttribute("aria-pressed", "false");
    // A touch down and up with no click event afterwards (what iOS does when it
    // takes the first tap as a hover).
    const box = (await mode.boundingBox())!;
    const at = { pointerId: 51, pointerType: "touch", isPrimary: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true };
    await mode.dispatchEvent("pointerdown", at);
    await mode.dispatchEvent("pointerup", at);
    await expect(mode).toHaveAttribute("aria-pressed", "true");
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
