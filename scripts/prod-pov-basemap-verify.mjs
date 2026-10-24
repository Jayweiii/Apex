/**
 * Prod Playwright: POV Street|Satellite toggle on session map.
 * Usage: node scripts/prod-pov-basemap-verify.mjs [sessionId]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = process.env.APEX_ARTIFACT_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const url = `${baseUrl}/sessions/${sessionId}`;
console.log(`Navigating: ${url}`);

const resp = await page.goto(url, {
  waitUntil: "networkidle",
  timeout: 90000,
});
console.log(`status ${resp?.status()}`);
await page.waitForTimeout(3000);

const guest = page.getByRole("button", { name: /continue as guest|browse/i });
if (await guest.isVisible().catch(() => false)) {
  await guest.click();
  await page.waitForTimeout(2000);
}

// Prefer a hot lap with GPS.
const lapCandidates = [
  page.getByRole("button", { name: /^0?2\b/ }),
  page.locator("button").filter({ hasText: /^0?2$/ }),
  page.locator("button").filter({ hasText: /1:\d{2}/ }),
];
for (const loc of lapCandidates) {
  if ((await loc.count()) > 0) {
    try {
      await loc.first().click({ timeout: 2000 });
      await page.waitForTimeout(1500);
      break;
    } catch {
      /* try next */
    }
  }
}

const povBtn = page.getByRole("button", { name: /^POV$/i });
await povBtn.first().click({ timeout: 10000 });
await page.waitForTimeout(2000);

const chase = page.locator('[data-apex-map="chase"], [data-apex-pov="1"]');
await chase.first().waitFor({ state: "visible", timeout: 15000 });

const basemapGroup = page.locator('[data-apex-basemap-toggle="1"]');
await basemapGroup.first().waitFor({ state: "visible", timeout: 10000 });

async function clickBasemap(label) {
  const btn = basemapGroup.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
  await btn.click({ timeout: 5000 });
  await page.waitForTimeout(2500);
}

async function snapshot(label) {
  const metrics = await page.evaluate(() => {
    const map =
      document.querySelector('[data-apex-map="chase"]') ||
      document.querySelector(".maplibregl-map");
    const canvas = document.querySelector(".maplibregl-canvas");
    const toggle = document.querySelector('[data-apex-basemap-toggle="1"]');
    const r = map?.getBoundingClientRect();
    // MapLibre canvas transform includes pitch (non-identity when chase).
    const transform = canvas ? getComputedStyle(canvas).transform : null;
    const pitchy =
      !!document.querySelector(".maplibregl-canvas") &&
      !!document.querySelector('[data-apex-pov="1"]');
    return {
      hasChase: !!document.querySelector('[data-apex-map="chase"]'),
      hasToggle: !!toggle,
      toggleText: toggle?.textContent || null,
      mapBox: r
        ? {
            width: Math.round(r.width),
            height: Math.round(r.height),
          }
        : null,
      hasCanvas: !!canvas,
      transform,
      pitchy,
      pressed: [...(toggle?.querySelectorAll('[aria-pressed="true"]') || [])].map(
        (el) => el.textContent?.trim(),
      ),
    };
  });
  const shot = path.join(outDir, `pov-basemap-${label}-1440x900.png`);
  await page.screenshot({ path: shot, fullPage: false });
  return { ...metrics, screenshot: shot };
}

await clickBasemap("Satellite");
const satellite = await snapshot("satellite");
console.log(JSON.stringify({ mode: "satellite", ...satellite }, null, 2));

await clickBasemap("Street");
const street = await snapshot("street");
console.log(JSON.stringify({ mode: "street", ...street }, null, 2));

// Confirm selection survives Overview → POV round-trip.
await page.getByRole("button", { name: /^Overview$/i }).first().click();
await page.waitForTimeout(1200);
const overviewToggle = page.locator('[data-apex-basemap-toggle="1"]');
await overviewToggle.first().waitFor({ state: "visible", timeout: 10000 });
const overviewPressed = await overviewToggle
  .locator('[aria-pressed="true"]')
  .first()
  .textContent();
await page.getByRole("button", { name: /^POV$/i }).first().click();
await page.waitForTimeout(1500);
const backPressed = await page
  .locator('[data-apex-basemap-toggle="1"] [aria-pressed="true"]')
  .first()
  .textContent();

const ok =
  satellite.hasChase &&
  street.hasChase &&
  satellite.hasToggle &&
  street.hasToggle &&
  (satellite.mapBox?.width ?? 0) > 400 &&
  (street.mapBox?.width ?? 0) > 400 &&
  satellite.pressed?.includes("Satellite") &&
  street.pressed?.includes("Street") &&
  /street/i.test(overviewPressed || "") &&
  /street/i.test(backPressed || "");

const summary = {
  ok,
  url,
  sessionId,
  satellite,
  street,
  persistedAcrossModes: {
    overviewPressed,
    povPressed: backPressed,
  },
};
const summaryPath = path.join(outDir, "pov-basemap-verify.json");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`Wrote ${summaryPath}`);
console.log(JSON.stringify(summary, null, 2));

await browser.close();
if (!ok) process.exit(1);
