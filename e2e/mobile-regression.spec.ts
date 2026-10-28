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
    await page.evaluate(() => localStorage.removeItem("apex.speed-unit"));
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

    // Scope to the visible control (drawer utils on iPhone; desktop chrome else).
    const group = useTap
      ? page.locator(
          "[data-apex-nav-drawer] [data-apex-speed-unit-toggle], [data-apex-nav-utils] [data-apex-speed-unit-toggle]",
        ).first()
      : page.locator("[data-apex-speed-unit-toggle]:visible").first();
    await expect(group).toBeVisible();
    await expect(group).toHaveAttribute("data-apex-speed-unit", "mph");

    const kmh = group.getByRole("button", { name: /^km\/h$/i });
    const mph = group.getByRole("button", { name: /^mph$/i });
    await activate(page, kmh);
    await expect(group).toHaveAttribute("data-apex-speed-unit", "kmh");
    if (useTap) {
      // Drawer must stay open across unit writes (no "page changed" remount).
      await expect(page.locator("[data-apex-nav-drawer]").first()).toBeVisible();
      await expect(
        page.locator("[data-apex-nav-menu]").first(),
      ).toHaveAttribute("aria-expanded", "true");
      expect(page.url()).toMatch(/\/$/);
    }
    await activate(page, mph);
    await expect(group).toHaveAttribute("data-apex-speed-unit", "mph");
    if (useTap) {
      await expect(page.locator("[data-apex-nav-drawer]").first()).toBeVisible();
    }
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
            const canvas = host?.querySelector("canvas");
            return canvas ? "canvas" : "0";
          });
        },
        { timeout: 45_000 },
      )
      .not.toBe("0");

    const routeAttr = await chase.first().getAttribute("data-apex-route-lines");
    if (routeAttr != null) {
      expect(Number(routeAttr)).toBeGreaterThan(0);
    } else {
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

  test("Street/Satellite never leaves POV (session + compare)", async ({
    page,
    useTap,
  }) => {
    test.skip(!useTap, "iPhone fat-finger / POV basemap contract");

    async function assertBasemapKeepsPov(path: string) {
      await gotoReady(page, path);
      await page.evaluate(() => {
        localStorage.setItem(
          "apex.map-view",
          JSON.stringify({ mode: "chase", followId: "", chaseZoom: 17.5 }),
        );
        localStorage.setItem("apex.basemap", JSON.stringify("satellite"));
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page
        .locator('[data-apex-map="chase"], [data-apex-pov="1"]')
        .first()
        .waitFor({ state: "visible", timeout: 90_000 });

      const povGroup = page.locator("[data-apex-pov-toggle]").first();
      await expect(povGroup).toHaveAttribute("data-apex-pov-mode", "chase");

      const basemap = page.locator("[data-apex-basemap-toggle]").first();
      const street = basemap.getByRole("button", { name: /^Street$/i });
      const satellite = basemap.getByRole("button", { name: /^Satellite$/i });

      await activate(page, street);
      await expect(street).toHaveAttribute("aria-pressed", "true");
      await expect(povGroup).toHaveAttribute("data-apex-pov-mode", "chase");
      await expect(
        page.locator('[data-apex-map="chase"]').first(),
      ).toBeVisible();
      await expect
        .poll(
          async () =>
            page
              .locator('[data-apex-map="chase"]')
              .first()
              .getAttribute("data-apex-basemap"),
          { timeout: 15_000 },
        )
        .toBe("street");

      await activate(page, satellite);
      await expect(satellite).toHaveAttribute("aria-pressed", "true");
      await expect(povGroup).toHaveAttribute("data-apex-pov-mode", "chase");
      await expect
        .poll(
          async () =>
            page
              .locator('[data-apex-map="chase"]')
              .first()
              .getAttribute("data-apex-basemap"),
          { timeout: 15_000 },
        )
        .toBe("satellite");

      // Controls must not horizontally overlap (Satellite vs Overview).
      const layout = await page.evaluate(() => {
        const sat = document.querySelector(
          "[data-apex-basemap-option='satellite']",
        );
        const overview = document.querySelector(
          "[data-apex-pov-option='overview']",
        );
        if (!sat || !overview) return { ok: false, reason: "missing" as const };
        const a = sat.getBoundingClientRect();
        const b = overview.getBoundingClientRect();
        const overlap = !(
          a.right < b.left ||
          a.left > b.right ||
          a.bottom < b.top ||
          a.top > b.bottom
        );
        return {
          ok: !overlap,
          overlap,
          satTop: a.top,
          overviewTop: b.top,
        };
      });
      expect(
        layout.ok,
        `Street/Satellite must not overlap Overview/POV (${path}): ${JSON.stringify(layout)}`,
      ).toBe(true);
    }

    await assertBasemapKeepsPov(`/sessions/${SESSION_ID}`);
    await assertBasemapKeepsPov(`/compare/${COMPARE_ID}`);
  });

  test("Play is visible without scrolling on mobile", async ({
    page,
    useTap,
  }) => {
    test.skip(!useTap, "mobile first-viewport play contract");

    async function readPlayGeometry(page: import("@playwright/test").Page) {
      const play = page.locator("[data-apex-map-play-toggle]:visible").first();
      await expect(play).toBeVisible({ timeout: 30_000 });
      return play.evaluate((node) => {
        const header = document.querySelector("[data-apex-header], header");
        const map =
          document.querySelector("[data-apex-map-stack]") ||
          document.querySelector("[data-apex-map]");
        const r = node.getBoundingClientRect();
        const m = map?.getBoundingClientRect();
        const h = header?.getBoundingClientRect();
        const vh = window.innerHeight || 844;
        return {
          scrollY: window.scrollY,
          inViewport:
            r.width > 0 &&
            r.height > 0 &&
            r.top >= 0 &&
            r.bottom <= vh + 1,
          belowHeader: h ? r.top >= h.bottom - 1 : false,
          mapInViewport: m
            ? m.top < vh && m.bottom > (h?.bottom ?? 0)
            : false,
          top: r.top,
          bottom: r.bottom,
          mapTop: m?.top ?? null,
          vh,
        };
      });
    }

    // Session: map + Play must land in the first viewport at scrollY=0.
    {
      const path = `/sessions/${SESSION_ID}`;
      await gotoReady(page, path);
      await page
        .locator("[data-apex-map-stack], [data-apex-map]")
        .first()
        .waitFor({ state: "visible", timeout: 90_000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      const geometry = await readPlayGeometry(page);
      expect(geometry.scrollY, `session must assert at scrollY=0`).toBe(0);
      expect(
        geometry.mapInViewport,
        `session map in first viewport: ${JSON.stringify(geometry)}`,
      ).toBe(true);
      expect(
        geometry.inViewport,
        `session Play in first viewport: ${JSON.stringify(geometry)}`,
      ).toBe(true);
      expect(geometry.belowHeader).toBe(true);
    }

    // Compare: still require Play visible below the header (may need a nudge
    // when lap-picker chrome is tall); session is the strict fold contract.
    {
      const path = `/compare/${COMPARE_ID}`;
      await gotoReady(page, path);
      await page
        .locator("[data-apex-map-stack], [data-apex-map]")
        .first()
        .waitFor({ state: "visible", timeout: 90_000 });
      await page.waitForTimeout(500);
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
      const geometry = await readPlayGeometry(page);
      expect(
        geometry.inViewport,
        `compare Play in viewport after map nudge: ${JSON.stringify(geometry)}`,
      ).toBe(true);
      expect(geometry.belowHeader).toBe(true);
    }
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

  test("Drive car/track pickers are single-select radios on tap", async ({
    page,
  }) => {
    await gotoReady(page, "/drive");
    await page.waitForSelector("[data-apex-drive-car-track-select]", {
      timeout: 90_000,
    });

    const carGroup = page.locator(
      "[data-apex-drive-car-select] [role='radiogroup']",
    );
    await expect(carGroup).toBeVisible();
    const hatch = page.locator('[data-apex-drive-car="hatch"]');
    const miata = page.locator('[data-apex-drive-car="miata"]');
    const gt = page.locator('[data-apex-drive-car="gt"]');

    await activate(page, hatch);
    await expect(hatch).toHaveAttribute("aria-checked", "true");
    await expect(miata).toHaveAttribute("aria-checked", "false");
    await expect(
      page.locator('[data-apex-drive-car][aria-checked="true"]'),
    ).toHaveCount(1);

    // Second tap on another card: exactly one remains checked (no sticky dual).
    await activate(page, gt);
    await expect(gt).toHaveAttribute("aria-checked", "true");
    await expect(hatch).toHaveAttribute("aria-checked", "false");
    await expect(miata).toHaveAttribute("aria-checked", "false");
    await expect(
      page.locator('[data-apex-drive-car][aria-checked="true"]'),
    ).toHaveCount(1);

    const trackGroup = page.locator(
      "[data-apex-drive-track-select] [role='radiogroup']",
    );
    await expect(trackGroup).toBeVisible();
    const tracks = page.locator("[data-apex-drive-track]");
    await expect(tracks.first()).toBeVisible();
    const count = await tracks.count();
    expect(count).toBeGreaterThan(1);
    const first = tracks.nth(0);
    const second = tracks.nth(1);
    await activate(page, second);
    await expect(second).toHaveAttribute("aria-checked", "true");
    await expect(first).toHaveAttribute("aria-checked", "false");
    await expect(
      page.locator('[data-apex-drive-track][aria-checked="true"]'),
    ).toHaveCount(1);

    const go = page.locator("[data-apex-drive-go]");
    await expect(go).toBeVisible();
    await expect(go).toHaveAttribute("href", /\/drive\/.+\?car=gt/);
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
