/**
 * Prod Playwright: POV chase pitch must stay ~60 across Street ↔ Satellite.
 * Usage: node scripts/prod-pov-street-tilt-verify.mjs [sessionId]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = process.env.APEX_ARTIFACT_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("/workspace/artifacts", { recursive: true });

function readMapFromFiber(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let fiber = key ? el[key] : null;
  while (fiber) {
    let s = fiber.memoizedState;
    while (s) {
      const m = s.memoizedState;
      if (m?.current?.getPitch) return m.current;
      s = s.next;
    }
    fiber = fiber.return;
  }
  return null;
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const url = `${baseUrl}/sessions/${sessionId}`;
console.log(`Navigating: ${url}`);

const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
console.log(`status ${resp?.status()}`);
await page.waitForTimeout(2500);

const guest = page.getByRole("button", { name: /continue as guest|browse/i });
if (await guest.isVisible().catch(() => false)) {
  await guest.click();
  await page.waitForTimeout(1500);
}

const lap = page.locator("button").filter({ hasText: /1:\d{2}/ }).first();
if ((await lap.count()) > 0) {
  await lap.click().catch(() => {});
  await page.waitForTimeout(1000);
}

await page.getByRole("button", { name: /^POV$/i }).first().click({ timeout: 15000 });
await page.waitForTimeout(2500);
await page.locator('[data-apex-map="chase"]').first().waitFor({ state: "visible" });
await page.locator('[data-apex-basemap-toggle="1"]').first().waitFor({ state: "visible" });

async function clickBasemap(label) {
  const t0 = Date.now();
  await page
    .locator('[data-apex-basemap-toggle="1"]')
    .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
    .click();
  await page.waitForTimeout(1200);
  return Date.now() - t0;
}

async function readCamera() {
  return page.evaluate((helperSrc) => {
    // eslint-disable-next-line no-new-func
    const readMapFromFiber = new Function(`return (${helperSrc})`)();
    const el = document.querySelector('[data-apex-map="chase"]');
    if (!el) return { error: "no chase" };
    const map = readMapFromFiber(el);
    const attrs = {
      pitchAttr: el.dataset.apexPitch ?? null,
      zoomAttr: el.dataset.apexZoom ?? null,
      bearingAttr: el.dataset.apexBearing ?? null,
      basemapAttr: el.dataset.apexBasemap ?? null,
    };
    if (!map) return { error: "no map", ...attrs };
    return {
      pitch: map.getPitch(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      maxPitch: map.getMaxPitch?.() ?? null,
      pressed: [
        ...document.querySelectorAll(
          '[data-apex-basemap-toggle="1"] [aria-pressed="true"]',
        ),
      ].map((e) => e.textContent?.trim()),
      ...attrs,
    };
  }, readMapFromFiber.toString());
}

async function snapshot(label) {
  const cam = await readCamera();
  const box = await page.locator('[data-apex-map="chase"]').boundingBox();
  const shot = path.join(outDir, `pov-street-tilt-${label}-1440x900.png`);
  const mapShot = path.join(outDir, `pov-street-tilt-map-${label}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  if (box) await page.screenshot({ path: mapShot, clip: box });
  fs.copyFileSync(shot, path.join("/workspace/artifacts", path.basename(shot)));
  if (fs.existsSync(mapShot)) {
    fs.copyFileSync(
      mapShot,
      path.join("/workspace/artifacts", path.basename(mapShot)),
    );
  }
  return { ...cam, screenshot: shot, mapScreenshot: mapShot };
}

const satSwapMs = await clickBasemap("Satellite");
const satellite = await snapshot("satellite");
console.log("SAT", JSON.stringify({ ...satellite, swapMs: satSwapMs }, null, 2));

const streetSwapMs = await clickBasemap("Street");
const street = await snapshot("street");
console.log(
  "STREET",
  JSON.stringify({ ...street, swapMs: streetSwapMs }, null, 2),
);

const pitchOk = (cam) =>
  typeof cam.pitch === "number" && cam.pitch >= 55 && cam.pitch <= 65;
const zoomMatch =
  typeof satellite.zoom === "number" &&
  typeof street.zoom === "number" &&
  Math.abs(satellite.zoom - street.zoom) < 0.05;
const bearingMatch =
  typeof satellite.bearing === "number" &&
  typeof street.bearing === "number" &&
  Math.abs(satellite.bearing - street.bearing) < 0.5;

const ok =
  pitchOk(satellite) &&
  pitchOk(street) &&
  zoomMatch &&
  bearingMatch &&
  satellite.pressed?.includes("Satellite") &&
  street.pressed?.includes("Street");

const summary = {
  ok,
  url,
  sessionId,
  measured: {
    satellitePitch: satellite.pitch,
    streetPitch: street.pitch,
    satelliteZoom: satellite.zoom,
    streetZoom: street.zoom,
    satelliteBearing: satellite.bearing,
    streetBearing: street.bearing,
    streetSwapMs,
    satSwapMs,
  },
  satellite,
  street,
};
const summaryPath = path.join(outDir, "pov-street-tilt-verify.json");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
fs.writeFileSync(
  "/workspace/artifacts/pov-street-tilt-verify.json",
  JSON.stringify(summary, null, 2),
);
console.log(`Wrote ${summaryPath}`);
console.log(JSON.stringify(summary, null, 2));

await browser.close();
if (!ok) process.exit(1);
