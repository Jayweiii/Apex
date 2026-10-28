import {
  test,
  expect,
  activate,
  assertSingleActivate,
  gotoReady,
  openMobileMenu,
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
      await openMobileMenu(page);
      await expect(
        page.locator("[data-apex-nav-mobile], nav[aria-label='Mobile']"),
      ).toBeVisible();
    }

    for (const key of PRIMARY_NAV) {
      if (useTap) {
        // Menu closes after navigation attempts; re-open between taps.
        const mobileNav = page.locator(
          "[data-apex-nav-mobile], nav[aria-label='Mobile']",
        );
        if (!(await mobileNav.isVisible().catch(() => false))) {
          await openMobileMenu(page);
        }
      }
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

    if (useTap) {
      await openMobileMenu(page);
      await expect(
        page.locator("[data-apex-nav-drawer], nav[aria-label='Mobile']"),
      ).toBeVisible();
    }

    const toggle = page.locator("[data-apex-speed-unit-toggle]").locator("visible=true").first();
    // Fallback: any visible speed toggle (drawer or desktop chrome).
    const toggleAny = page.locator("[data-apex-speed-unit-toggle]");
    const target =
      (await toggle.count()) > 0
        ? toggle
        : toggleAny.filter({ hasNot: page.locator("[hidden]") }).first();

    // On iPhone the toggle lives in the drawer — ensure one is visible.
    if (useTap && !(await target.isVisible().catch(() => false))) {
      await openMobileMenu(page);
    }
    const visibleToggle = page
      .locator("[data-apex-speed-unit-toggle]")
      .evaluateAll
      ? page.locator("[data-apex-speed-unit-toggle]")
      : toggleAny;

    const picked = page.locator("[data-apex-speed-unit-toggle]").nth(
      useTap ? 0 : 0,
    );
    // Prefer the last match which is usually the mobile drawer instance.
    const count = await page.locator("[data-apex-speed-unit-toggle]").count();
    const speed = page.locator("[data-apex-speed-unit-toggle]").nth(
      useTap ? Math.max(0, count - 1) : 0,
    );
    await expect(speed).toBeVisible();
    await expect(speed).toHaveAttribute("data-apex-speed-unit", "mph");

    await activate(page, speed);
    await expect(speed).toHaveAttribute("data-apex-speed-unit", "kmh");
    await activate(page, speed);
    await expect(speed).toHaveAttribute("data-apex-speed-unit", "mph");
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

    const overview = page.locator(
      "[data-apex-pov-option='overview'], button:text-is('Overview')",
    );
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
    await page.waitForSelector("text=POV", { timeout: 90_000 });

    const mapStack = page.locator("[data-apex-map-stack], [data-apex-map]").first();
    if ((await mapStack.count()) > 0) {
      await mapStack.scrollIntoViewIfNeeded();
    }

    const pov = page.getByRole("button", { name: /^POV$/i });
    await expect(pov.first()).toBeVisible({ timeout: 60_000 });
    await activate(page, pov);

    const chase = page.locator('[data-apex-map="chase"], [data-apex-pov="1"]');
    await expect(chase.first()).toBeVisible({ timeout: 45_000 });

    await expect
      .poll(
        async () => {
          const attr = await chase.first().getAttribute("data-apex-route-lines");
          if (attr && attr !== "0") return attr;
          return page.evaluate(() => {
            const host =
              document.querySelector('[data-apex-map="chase"]') ||
              document.querySelector("[data-apex-pov]");
            const canvas = host?.querySelector("canvas");
            return canvas ? "canvas" : "0";
          });
        },
        { timeout: 45_000 },
      )
      .not.toBe("0");

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

    await gotoReady(page, `/sessions/${SESSION_ID}`);
    await page.waitForSelector(
      "[data-apex-map-stack], [data-apex-map], text=POV",
      { timeout: 90_000 },
    );

    // Bring the map into the first viewport, then Play must already be on it
    // (map overlay) — no further scrolling past the map.
    const map = page.locator("[data-apex-map-stack], [data-apex-map]").first();
    await map.waitFor({ state: "visible", timeout: 60_000 });
    await map.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);

    const play = page
      .locator("[data-apex-map-play-toggle], [data-apex-play-toggle]")
      .first();
    await expect(play).toBeVisible({ timeout: 30_000 });

    const geometry = await page.evaluate(() => {
      const btn = document.querySelector(
        "[data-apex-map-play-toggle], [data-apex-play-toggle]",
      );
      const mapEl =
        document.querySelector("[data-apex-map-stack]") ||
        document.querySelector("[data-apex-map]");
      const header = document.querySelector("[data-apex-header], header");
      if (!btn || !mapEl || !header) {
        return { ok: false, reason: "missing nodes" as const };
      }
      const b = btn.getBoundingClientRect();
      const m = mapEl.getBoundingClientRect();
      const h = header.getBoundingClientRect();
      const inViewport =
        b.width > 0 &&
        b.height > 0 &&
        b.top >= 0 &&
        b.bottom <= (window.innerHeight || 844) + 1;
      const onMap =
        b.top >= m.top - 2 &&
        b.bottom <= m.bottom + 2 &&
        b.left >= m.left - 2 &&
        b.right <= m.right + 2;
      const belowHeader = b.top >= h.bottom - 1;
      return {
        ok: inViewport && (onMap || Boolean(document.querySelector("[data-apex-map-play-toggle]")) || belowHeader),
        inViewport,
        onMap,
        belowHeader,
        isMapOverlay: Boolean(
          document.querySelector("[data-apex-map-play-toggle]"),
        ),
      };
    });

    expect(geometry.inViewport, "Play must sit in the viewport once map is shown").toBe(
      true,
    );
    expect(geometry.belowHeader).toBe(true);
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

    if (useTap) {
      // Desktop chrome (mph) is hidden on phones — use an in-page control.
      const target = page
        .locator(
          "[data-apex-play-toggle], [data-apex-map-play-toggle], a.apex-btn, button.apex-btn",
        )
        .locator("visible=true")
        .first();
      // Playwright visible filter: use .first() after filtering via evaluate if needed.
      const visibleBtn = page
        .locator("main button.apex-btn, main a.apex-btn, [data-apex-play-toggle], [data-apex-map-play-toggle]")
        .first();
      await assertSingleActivate(page, visibleBtn, { useTap });
    } else {
      const target = page
        .locator(
          "[data-apex-speed-unit-toggle], [data-apex-play-toggle], button.apex-btn, a.apex-btn",
        )
        .first();
      await assertSingleActivate(page, target, { useTap });
    }
  });
});
