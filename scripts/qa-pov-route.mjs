/**
 * Playwright: POV chase map must draw lap route line(s) on session (+ optional compare),
 * survive Street↔Satellite and Overview↔POV toggles, and must not hit MapLibre worker errors.
 *
 * Usage:
 *   node scripts/qa-pov-route.mjs [sessionId]
 *   APEX_PROD_URL=https://… APEX_COMPARE_URL=https://…/lap-comparisons/… node scripts/qa-pov-route.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const compareUrl = process.env.APEX_COMPARE_URL || "";
const outDir =
  process.env.APEX_ARTIFACT_DIR || "/workspace/artifacts/pov-route";
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });

function readMapFromFiber(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber"));
  let fiber = key ? el[key] : null;
  while (fiber) {
    let s = fiber.memoizedState;
    while (s) {
      const m = s.memoizedState;
      if (m?.current?.getPitch && m?.current?.getStyle) return m.current;
      s = s.next;
    }
    fiber = fiber.return;
  }
  return null;
}

async function dismissGuest(page) {
  const guest = page.getByRole("button", { name: /continue as guest|browse/i });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(1200);
  }
}

async function enterPov(page) {
  const lap = page.locator("button").filter({ hasText: /1:\d{2}/ }).first();
  if ((await lap.count()) > 0) {
    await lap.click().catch(() => {});
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: /^POV$/i }).first().click({ timeout: 15000 });
  await page.locator('[data-apex-map="chase"]').first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(2000);
}

async function clickBasemap(page, label) {
  await page
    .locator('[data-apex-basemap-toggle="1"]')
    .getByRole("button", { name: new RegExp(`^${label}$`, "i") })
    .click();
  await page.waitForTimeout(1500);
}

async function inspectChase(page) {
  return page.evaluate((helperSrc) => {
    const readMapFromFiber = new Function(`return (${helperSrc})`)();
    const el = document.querySelector('[data-apex-map="chase"]');
    if (!el) return { error: "no chase" };
    const map = readMapFromFiber(el);
    const style = map?.getStyle?.();
    const layers = (style?.layers || []).map((l) => l.id);
    const sources = Object.keys(style?.sources || {});
    const lapLayers = layers.filter((id) => id.startsWith("lap-line-"));
    const lapSources = sources.filter((id) => id.startsWith("lap-src-"));
    const sourceFeatures = {};
    for (const sid of lapSources) {
      try {
        sourceFeatures[sid] = map.querySourceFeatures(sid)?.length ?? 0;
      } catch (e) {
        sourceFeatures[sid] = String(e);
      }
    }
    return {
      routeAttr: el.dataset.apexRouteLines ?? null,
      pitch: map?.getPitch?.() ?? null,
      basemapAttr: el.dataset.apexBasemap ?? null,
      lapLayers,
      lapSources,
      sourceFeatures,
      workerOkHint: lapLayers.length > 0,
    };
  }, readMapFromFiber.toString());
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const workerErrors = [];
const consoleErrors = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (/Worker failed to load/i.test(text)) workerErrors.push(text);
  if (msg.type() === "error") consoleErrors.push(text);
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const sessionUrl = `${baseUrl}/sessions/${sessionId}`;
console.log("session", sessionUrl);
await page.goto(sessionUrl, { waitUntil: "networkidle", timeout: 90000 });
await dismissGuest(page);
await enterPov(page);

const snapshots = {};

async function snap(label) {
  const info = await inspectChase(page);
  const box = await page.locator('[data-apex-map="chase"]').boundingBox();
  const shot = path.join(outDir, `pov-route-${label}.png`);
  if (box) await page.screenshot({ path: shot, clip: box });
  else await page.screenshot({ path: shot, fullPage: false });
  try {
    fs.copyFileSync(shot, path.join("/opt/cursor/artifacts", path.basename(shot)));
  } catch {
    /* optional */
  }
  snapshots[label] = { ...info, screenshot: shot };
  console.log(label, JSON.stringify(info));
  return info;
}

await clickBasemap(page, "Satellite");
const sat = await snap("session-satellite");
await clickBasemap(page, "Street");
const street = await snap("session-street");

await page.getByRole("button", { name: /^Overview$/i }).first().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^POV$/i }).first().click();
await page.waitForTimeout(2000);
const afterToggle = await snap("session-after-pov-toggle");

let compare = null;
if (compareUrl) {
  console.log("compare", compareUrl);
  await page.goto(compareUrl, { waitUntil: "networkidle", timeout: 90000 });
  await dismissGuest(page);
  await enterPov(page);
  compare = await snap("compare-satellite");
}

const featureCount = (info) =>
  Object.values(info?.sourceFeatures || {}).reduce(
    (n, v) => n + (typeof v === "number" ? v : 0),
    0,
  );

const sessionOk =
  workerErrors.length === 0 &&
  (sat.lapLayers?.length ?? 0) >= 1 &&
  (street.lapLayers?.length ?? 0) >= 1 &&
  (afterToggle.lapLayers?.length ?? 0) >= 1 &&
  featureCount(sat) > 0 &&
  featureCount(street) > 0 &&
  featureCount(afterToggle) > 0 &&
  Number(sat.routeAttr || 0) >= 1 &&
  Number(street.routeAttr || 0) >= 1;

const compareOk =
  !compareUrl ||
  ((compare?.lapLayers?.length ?? 0) >= 1 && featureCount(compare) > 0);

const ok = sessionOk && compareOk;
const summary = {
  ok,
  sessionOk,
  compareOk,
  sessionUrl,
  compareUrl: compareUrl || null,
  workerErrors,
  consoleErrors: consoleErrors.slice(0, 20),
  snapshots,
};
const summaryPath = path.join(outDir, "pov-route-verify.json");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
try {
  fs.copyFileSync(summaryPath, "/opt/cursor/artifacts/pov-route-verify.json");
} catch {
  /* optional */
}
console.log(JSON.stringify(summary, null, 2));
await browser.close();
if (!ok) process.exit(1);
