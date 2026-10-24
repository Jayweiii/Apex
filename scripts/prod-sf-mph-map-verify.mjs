/**
 * Playwright against PRODUCTION: map height, mph default, SF editor tiles+handles.
 * Usage: node scripts/prod-sf-mph-map-verify.mjs [sessionId]
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = "/opt/cursor/artifacts";
const repoArtifacts = path.join(process.cwd(), "artifacts");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(repoArtifacts, { recursive: true });

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, device: null },
  {
    name: "iphone-390x844",
    width: 390,
    height: 844,
    device: devices["iPhone 12"],
  },
];

function saveShot(page, name) {
  const a = path.join(outDir, name);
  const b = path.join(repoArtifacts, name);
  return page.screenshot({ path: a, fullPage: false }).then(() => {
    fs.copyFileSync(a, b);
    return a;
  });
}

async function measure(page) {
  await page.waitForTimeout(3000);

  // Prefer a hot lap (not the short in-lap).
  for (const loc of [
    page.getByRole("button", { name: /^0?2\b/ }),
    page.locator("button").filter({ hasText: /^0?2$/ }),
    page.locator("button").filter({ hasText: /1:\d{2}/ }),
  ]) {
    if ((await loc.count()) > 0) {
      try {
        await loc.first().click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        break;
      } catch {
        /* next */
      }
    }
  }

  // Overview for SF / Leaflet
  const overview = page.getByRole("button", { name: /^Overview$/i });
  if (await overview.count()) {
    try {
      await overview.first().click({ timeout: 1500 });
      await page.waitForTimeout(800);
    } catch {
      /* */
    }
  }

  const beforeEdit = await page.evaluate(() => {
    const map =
      document.querySelector('[data-apex-map="fixed-scrub"]') ||
      document.querySelector(".leaflet-container");
    const wrap =
      map?.closest("[data-apex-sf-editing]") ||
      map?.parentElement;
    const r = (map || wrap)?.getBoundingClientRect();
    const tiles = [...document.querySelectorAll(".leaflet-tile-loaded")].length;
    const handles = document.querySelectorAll(".apex-sf-handle").length;
    const leafletClasses = map?.className || "";
    const bodyText = document.body.innerText;
    const mphHits = (bodyText.match(/\bmph\b/gi) || []).length;
    const kmhHits = (bodyText.match(/\bkm\/h\b/gi) || []).length;
    const peak = document.querySelector("[data-apex-peak-speed]")?.textContent || null;
    const unitToggle = document.querySelector("[data-apex-speed-unit-toggle]");
    const chartUnit = document.querySelector("[data-apex-speed-unit-label]")?.getAttribute("data-apex-speed-unit-label");
    return {
      mapHeight: r ? Math.round(r.height) : null,
      mapWidth: r ? Math.round(r.width) : null,
      tiles,
      handles,
      leafletHasContainerClass: /\bleaflet-container\b/.test(leafletClasses),
      mountClass: leafletClasses.slice(0, 120),
      mapIsInner: map?.classList.contains("h-full") || map?.getAttribute("class") === "h-full w-full" || (map?.className || "").includes("h-full"),
      peak,
      chartUnit,
      unitToggle: unitToggle?.textContent?.trim() || null,
      unitToggleAttr: unitToggle?.getAttribute("data-apex-speed-unit"),
      mphHits,
      kmhHits,
      hasEditBtn: Boolean(
        document.querySelector("[data-apex-sf-editor] button"),
      ),
      editLabel: document
        .querySelector("[data-apex-sf-editor]")
        ?.textContent?.slice(0, 80),
    };
  });

  // Try Edit start/finish if owner UI is present
  let afterEdit = null;
  const editBtn = page.locator("[data-apex-sf-editor] button", {
    hasText: /Edit start\/finish/i,
  });
  if ((await editBtn.count()) > 0) {
    await editBtn.first().click();
    await page.waitForTimeout(2000);
    afterEdit = await page.evaluate(() => {
      const map = document.querySelector('[data-apex-map="fixed-scrub"]');
      const wrap = document.querySelector("[data-apex-sf-editing]");
      const tiles = [...document.querySelectorAll(".leaflet-tile-loaded")].map(
        (t) => ({
          loaded: t.classList.contains("leaflet-tile-loaded"),
          opacity: getComputedStyle(t).opacity,
        }),
      );
      const handles = document.querySelectorAll(".apex-sf-handle").length;
      return {
        sfEditing: wrap?.getAttribute("data-apex-sf-editing"),
        mapClass: map?.className,
        leafletContainerAlive: Boolean(
          document.querySelector(".leaflet-container.leaflet-touch, .leaflet-container"),
        ),
        leafletClassOnMount: map?.className || "",
        tilesLoaded: tiles.filter((t) => t.loaded).length,
        handles,
        mapHeight: map
          ? Math.round(map.getBoundingClientRect().height)
          : null,
        saveVisible: Boolean(
          [...document.querySelectorAll("button")].find((b) =>
            /Save start\/finish/i.test(b.textContent || ""),
          ),
        ),
      };
    });
  } else {
    // Simulate the former bug: rewrite mount className like React used to.
    // With the fix, mount node should keep leaflet-container; wrapper holds chrome.
    afterEdit = await page.evaluate(() => {
      const map = document.querySelector('[data-apex-map="fixed-scrub"]');
      const wrap = map?.parentElement;
      if (!map || !wrap) return { simulated: false, reason: "no map" };
      const before = map.className;
      // What the bug did: replace entire class on the leaflet root.
      // After fix, React only updates the WRAPPER — so simulating React's
      // wrapper update should leave leaflet-container intact.
      wrap.setAttribute("data-apex-sf-editing", "1");
      const touch = wrap.className.includes("touch-none")
        ? wrap.className.replace("touch-none", "touch-manipulation")
        : wrap.className + " touch-manipulation";
      wrap.className = touch;
      // Force a layout/style flush
      void wrap.offsetHeight;
      const tiles = document.querySelectorAll(".leaflet-tile-loaded").length;
      const handles = document.querySelectorAll(".apex-sf-handle").length;
      return {
        simulated: true,
        beforeMountClass: before,
        afterMountClass: map.className,
        stillHasLeafletContainer: /\bleaflet-container\b/.test(map.className),
        tilesLoaded: tiles,
        handles,
        sfEditing: wrap.getAttribute("data-apex-sf-editing"),
        mapHeight: Math.round(map.getBoundingClientRect().height),
      };
    });
  }

  return { beforeEdit, afterEdit };
}

const results = [];
for (const vp of viewports) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    vp.device
      ? { ...devices["iPhone 12"], viewport: { width: vp.width, height: vp.height } }
      : { viewport: { width: vp.width, height: vp.height } },
  );
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sessions/${sessionId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  const measured = await measure(page);
  const shotBefore = await saveShot(
    page,
    `prod-sf-mph-${vp.name}-overview.png`,
  );
  // If edit was opened, screenshot that; else screenshot after simulation
  const shotSf = await saveShot(page, `prod-sf-mph-${vp.name}-sf-editor.png`);
  results.push({
    viewport: vp.name,
    ...measured,
    screenshots: { overview: shotBefore, sf: shotSf },
  });
  await browser.close();
}

const summaryPath = path.join(outDir, "prod-sf-mph-map-verify.json");
fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
fs.copyFileSync(
  summaryPath,
  path.join(repoArtifacts, "prod-sf-mph-map-verify.json"),
);
console.log(JSON.stringify({ ok: true, results }, null, 2));
