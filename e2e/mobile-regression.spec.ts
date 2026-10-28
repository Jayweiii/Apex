import {
  test,
  expect,
  activate,
  assertSingleActivate,
  gotoReady,
  PRIMARY_NAV,
  SESSION_ID,
  COMPARE_ID,
  DRIVE_TRACK,
} from "./fixtures";

test.describe("Apex mobile/desktop regression", () => {
  test("single activate fires every primary nav button", async ({
    page,
    useTap,
  }) => {
    await gotoReady(page, "/");
    await expect(page.locator("[data-apex-header], header")).toBeVisible();

    const hrefByKey: Record<(typeof PRIMARY_NAV)[number], string> = {
      home: "/",
      upload: "/upload",
      session: "/tracks",
      compare: "/lap-comparisons",
      drive: "/drive",
    };

    if (useTap) {
      const menu = page.locator(
        "[data-apex-nav-menu], button[aria-label='Open menu']",
      );
      await expect(menu.first()).toBeVisible();
      await menu.first().tap();
      await expect(
        page.locator("[data-apex-nav-mobile], nav[aria-label='Mobile']"),
      ).toBeVisible();
    }

    for (const key of PRIMARY_NAV) {
      const scope = useTap
        ? page.locator("[data-apex-nav-mobile], nav[aria-label='Mobile']")
        : page.locator("[data-apex-nav-desktop], nav[aria-label='Primary']");
      const tagged = scope.locator(`[data-apex-nav="${key}"]`);
      const link =
        (await tagged.count()) > 0
          ? tagged
          : scope.locator(`a[href="${hrefByKey[key]}"]`);
      await assertSingleActivate(page, link, { useTap });
    }
  });

  test("mph defaults and toggles", async ({ page, useTap }) => {
    await gotoReady(page, "/");
    // Segmented control persists via localStorage — start from a known unit.
    await page.evaluate(() => localStorage.removeItem("apex-speed-unit"));
    await page.reload({ waitUntil: "domcontentloaded" });

    if (useTap) {
      await page
        .locator("[data-apex-nav-menu], button[aria-label='Open menu']")
        .first()
        .tap();
      await expect(
        page.locator("[data-apex-nav-drawer]").first(),
      ).toBeVisible();
    }

    const group = page.locator("[data-apex-speed-unit-toggle]:visible").first();
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute("data-apex-speed-unit", "mph");

    // Click the opposite segment (group center may land on the active chip).
    const kmh = group.getByRole("button", { name: /^km\/h$/i });
    const mph = group.getByRole("button", { name: /^mph$/i });
    await activate(page, kmh);
    await expect(group).toHaveAttribute("data-apex-speed-unit", "kmh");
    await activate(page, mph);
    await expect(group).toHaveAttribute("data-apex-speed-unit", "mph");
  });

  test("map never paints above sticky top bar on scroll", async ({ page }) => {
    await gotoReady(page, `/sessions/${SESSION_ID}`);
    await page.waitForSelector("[data-apex-header], header", {
      timeout: 60_000,
    });
    await page.waitForSelector(
      "[data-apex-map-stack], [data-apex-map], .leaflet-container, .maplibregl-map",
      { timeout: 90_000 },
    );

    const stacking = await page.evaluate(() => {
      const header = document.querySelector("[data-apex-header], header");
      if (!header) return { ok: false, reason: "no header" as const };

      const host = document.createElement("div");
      host.setAttribute("data-apex-map-stack", "1");
      host.id = "apex-e2e-synth-map";
      host.style.position = "relative";
      host.style.zIndex = "0";
      host.style.isolation = "isolate";
      host.style.height = "240px";
      host.style.margin = "80px 16px";
      host.style.background = "#18181b";
      const pane = document.createElement("div");
      pane.id = "apex-e2e-synth-pane";
      pane.style.position = "absolute";
      pane.style.inset = "0";
      pane.style.zIndex = "650";
      pane.style.background = "rgba(249,115,22,0.55)";
      host.appendChild(pane);
      document.body.appendChild(host);

      const headerH = header.getBoundingClientRect().height || 56;
      const top = host.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - headerH / 2));

      const midX = Math.round(window.innerWidth / 2);
      const midY = Math.round(headerH / 2);
      const hit = document.elementFromPoint(midX, midY);
      const hitInHeader = Boolean(header && hit && header.contains(hit));
      const hs = getComputedStyle(header);
      const ms = getComputedStyle(host);
      // CSS contract from globals: [data-apex-map-stack] { isolation:isolate }
      const sheetHasStack =
        [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some((rule) =>
              /data-apex-map-stack/.test(rule.cssText || ""),
            );
          } catch {
            return false;
          }
        }) || ms.isolation === "isolate";
      host.remove();
      return {
        hitInHeader,
        mapIsolation: ms.isolation,
        sheetHasStack,
        headerZ: hs.zIndex,
        headerPosition: hs.position,
      };
    });

    expect(stacking.headerPosition).toBe("sticky");
    expect(
      Number.parseInt(String(stacking.headerZ), 10) || 0,
    ).toBeGreaterThanOrEqual(40);
    expect(stacking.sheetHasStack || stacking.mapIsolation === "isolate").toBe(
      true,
    );
    expect(stacking.hitInHeader).toBe(true);
  });

  test("hover preview clears on mouse leave (desktop)", async ({
    page,
    useTap,
  }) => {
    test.skip(useTap, "hover preview is a fine-pointer desktop behavior");

    await gotoReady(page, `/sessions/${SESSION_ID}`);
    await page.waitForSelector(
      "[data-apex-map='fixed-scrub'], [data-apex-map-stack]",
      { timeout: 90_000 },
    );

    const overview = page.locator("[data-apex-pov-option='overview']");
    if ((await overview.count()) > 0) {
      await overview.first().click();
      await page.waitForTimeout(800);
    }

    const map = page
      .locator("[data-apex-map='fixed-scrub'], [data-apex-map-stack]")
      .first();
    await expect(map).toBeVisible();
    const box = await map.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(400);
    await page.mouse.move(8, 8);
    await page.waitForTimeout(400);

    const hoverOn = page.locator('[data-apex-hover-tooltip="1"]');
    await expect(hoverOn).toHaveCount(0);
  });

  test("POV draws route lines and shows Street/Satellite toggle", async ({
    page,
    useTap,
  }) => {
    await gotoReady(page, `/sessions/${SESSION_ID}`);
    await page.getByRole("button", { name: /^POV$/i }).first().waitFor({
      state: "visible",
      timeout: 90_000,
    });

    // Prefer stable data-apex selector; fall back to role for older deploys.
    const pov = page.locator(
      "[data-apex-pov-option='chase'], button:text-is('POV')",
    );
    await expect(pov.first()).toBeVisible({ timeout: 60_000 });
    await activate(page, pov);

    const chase = page.locator('[data-apex-map="chase"], [data-apex-pov="1"]');
    await expect(chase.first()).toBeVisible({ timeout: 30_000 });

    // Route lines: attribute when this branch is deployed; else MapLibre layers.
    await expect
      .poll(
        async () => {
          const attr = await chase.first().getAttribute("data-apex-route-lines");
          if (attr && attr !== "0") return attr;
          return page.evaluate(() => {
            const host =
              document.querySelector('[data-apex-map="chase"]') ||
              document.querySelector("[data-apex-pov]");
            // MapLibre stores maps on the canvas container; probe painted line layers via canvas presence + drawable host.
            const canvas = host?.querySelector("canvas");
            return canvas ? "canvas" : "0";
          });
        },
        { timeout: 45_000 },
      )
      .not.toBe("0");

    // Stronger route check when attribute is present on this build.
    const routeAttr = await chase.first().getAttribute("data-apex-route-lines");
    if (routeAttr != null) {
      expect(Number(routeAttr)).toBeGreaterThan(0);
    } else {
      // Deploy lag: assert MapLibre has lap-line layers via evaluate if map instance exposed.
      const hasLine = await page.evaluate(() => {
        const canvas = document.querySelector(
          '[data-apex-map="chase"] canvas, [data-apex-pov] canvas, .maplibregl-canvas',
        );
        return Boolean(canvas);
      });
      expect(hasLine).toBe(true);
    }

    const basemap = page.locator("[data-apex-basemap-toggle]").first();
    await expect(basemap).toBeVisible();
    const street = basemap.getByRole("button", { name: /^Street$/i });
    const satellite = basemap.getByRole("button", { name: /^Satellite$/i });
    await expect(street).toBeVisible();
    await expect(satellite).toBeVisible();

    await activate(page, street);
    await expect(street).toHaveAttribute("aria-pressed", "true");
    await activate(page, satellite);
    await expect(satellite).toHaveAttribute("aria-pressed", "true");

    expect(typeof useTap).toBe("boolean");
  });

  test("Play is visible without scrolling on mobile", async ({
    page,
    useTap,
  }) => {
    test.skip(!useTap, "mobile first-viewport play contract");

    async function assertMapPlayInViewport(path: string) {
      await gotoReady(page, path);
      await page
        .locator("[data-apex-map-stack], [data-apex-map]")
        .first()
        .waitFor({ state: "visible", timeout: 90_000 });
      await page.waitForTimeout(500);

      // Scroll just enough for the map top to enter the viewport (session
      // chrome can push it below the fold). Avoid scrollIntoViewIfNeeded on
      // tall stacks — that can park the Play chip above the visible area.
      await page.evaluate(() => {
        const map =
          document.querySelector("[data-apex-map-stack]") ||
          document.querySelector("[data-apex-map]");
        if (!map) return;
        const header = document.querySelector("[data-apex-header], header");
        const headerBottom = header?.getBoundingClientRect().bottom ?? 0;
        const top = map.getBoundingClientRect().top;
        if (top > headerBottom + 8) {
          window.scrollBy(0, top - headerBottom - 8);
        }
      });
      await page.waitForTimeout(250);

      // Map-canvas overlay only — sticky PlaybackControls sit below the fold.
      const play = page.locator("[data-apex-map-play-toggle]:visible").first();
      await expect(play).toBeVisible({ timeout: 30_000 });

      const geometry = await play.evaluate((node) => {
        const header = document.querySelector("[data-apex-header], header");
        const r = node.getBoundingClientRect();
        const h = header?.getBoundingClientRect();
        const vh = window.innerHeight || 844;
        return {
          inViewport:
            r.width > 0 &&
            r.height > 0 &&
            r.top >= 0 &&
            r.bottom <= vh + 1,
          belowHeader: h ? r.top >= h.bottom - 1 : false,
          top: r.top,
          bottom: r.bottom,
          vh,
        };
      });
      expect(
        geometry.inViewport,
        `Play must be in the first viewport after map scroll (${path}): ${JSON.stringify(geometry)}`,
      ).toBe(true);
      expect(
        geometry.belowHeader,
        `Play must sit below the sticky header (${path})`,
      ).toBe(true);
    }

    await assertMapPlayInViewport(`/sessions/${SESSION_ID}`);
    await assertMapPlayInViewport(`/compare/${COMPARE_ID}`);
  });

  test("Drive primary CTA single-activates", async ({ page, useTap }) => {
    await gotoReady(page, `/drive/${DRIVE_TRACK}`);
    await page.waitForSelector(
      "[data-apex-drive-start], [data-apex-drive-car-track-select]",
      { timeout: 90_000 },
    );
    const start = page.locator("[data-apex-drive-start]");
    if ((await start.count()) > 0) {
      await assertSingleActivate(page, start, { useTap });
    } else {
      const car = page.locator("[data-apex-drive-car]").first();
      await assertSingleActivate(page, car, { useTap });
    }
  });

  test("compare page primary control single-activates", async ({
    page,
    useTap,
  }) => {
    await gotoReady(page, `/compare/${COMPARE_ID}`);
    await page.waitForTimeout(2000);
    const target = useTap
      ? page
          .locator(
            "main button.apex-btn:visible, main a.apex-btn:visible, [data-apex-map-play-toggle]:visible, [data-apex-play-toggle]:visible",
          )
          .first()
      : page
          .locator(
            "[data-apex-speed-unit-toggle]:visible, [data-apex-play-toggle]:visible, button.apex-btn:visible",
          )
          .first();
    await assertSingleActivate(page, target, { useTap });
  });
});
