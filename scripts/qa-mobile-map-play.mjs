/**
 * iPhone 390px: Play/Pause sits on the map (session + compare) without
 * scrolling, stays clear of Street/Satellite, and never covers the sticky
 * top bar. Single-tap toggles play. Visible in Overview and POV.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 node scripts/qa-mobile-map-play.mjs
 *   BASE_URL=https://… VERCEL_SHARE=… node scripts/qa-mobile-map-play.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const SESSION =
  process.env.APEX_SESSION_ID || "340f914a-49f7-4c6e-bccc-33a3fe2de689";
const OUT =
  process.env.OUT_DIR || "/opt/cursor/artifacts/mobile-map-play";
mkdirSync(OUT, { recursive: true });

const proof = {
  base: BASE,
  session: SESSION,
  at: new Date().toISOString(),
  checks: {},
};

function ok(name, pass, detail) {
  proof.checks[name] = { pass: Boolean(pass), detail };
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name} — ${
      typeof detail === "string" ? detail : JSON.stringify(detail)
    }`,
  );
}

async function withShare(context) {
  const share = process.env.VERCEL_SHARE || process.env.VERCEL_SHARE_COOKIE;
  if (!share) return;
  const host = new URL(BASE).hostname;
  await context.addCookies([
    {
      name: "_vercel_share",
      value: share.replace(/^_vercel_share=/, ""),
      domain: host,
      path: "/",
    },
  ]);
}

async function headerBottom(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return 0;
    return header.getBoundingClientRect().bottom;
  });
}

async function layoutProbe(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector("[data-apex-map-play-overlay]");
    const btn = document.querySelector("[data-apex-map-play-toggle]");
    const basemap = document.querySelector("[data-apex-basemap-toggle]");
    const map =
      document.querySelector("[data-apex-map-stack]") ||
      document.querySelector("[data-apex-map]");
    const header = document.querySelector("header");
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        top: r.top,
        left: r.left,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        visible:
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          r.width > 0 &&
          r.height > 0,
      };
    };
    const o = box(overlay);
    const b = box(btn);
    const m = box(map);
    const bm = box(basemap);
    const h = box(header);
    const overlapBasemap =
      b && bm
        ? !(
            b.right < bm.left ||
            b.left > bm.right ||
            b.bottom < bm.top ||
            b.top > bm.bottom
          )
        : false;
    const aboveHeader = b && h ? b.top < h.bottom - 1 : false;
    const insideMapViewport =
      b && m
        ? b.top >= m.top - 2 &&
          b.bottom <= m.bottom + 2 &&
          b.left >= m.left - 2 &&
          b.right <= m.right + 2
        : false;
    return {
      overlay: o,
      button: b,
      map: m,
      basemap: bm,
      header: h,
      overlapBasemap,
      aboveHeader,
      insideMapViewport,
      label: btn?.textContent?.trim() || null,
    };
  });
}

async function readPlaying(page) {
  return page.evaluate(() => {
    const btn = document.querySelector("[data-apex-map-play-toggle]");
    return btn?.getAttribute("aria-label") === "Pause";
  });
}

async function runPage(browser, path, shotName) {
  const context = await browser.newContext({
    ...devices["iPhone 12"],
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await withShare(context);
  const page = await context.newPage();
  const url = `${BASE}${path}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("[data-apex-map-stack], [data-apex-map]", {
    timeout: 90000,
  });
  await page.waitForSelector("[data-apex-map-play-toggle]", { timeout: 60000 });
  await page.waitForTimeout(2500);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // If map starts below the fold (session chrome), scroll just enough so the
  // map top enters the viewport — Play must then be visible without more scroll.
  const mapTop0 = await page.evaluate(() => {
    const map =
      document.querySelector("[data-apex-map-stack]") ||
      document.querySelector("[data-apex-map]");
    return map?.getBoundingClientRect().top ?? 0;
  });
  if (mapTop0 > 200) {
    await page.evaluate((y) => window.scrollBy(0, Math.max(0, y - 72)), mapTop0);
    await page.waitForTimeout(250);
  }

  const before = await layoutProbe(page);
  ok(`${shotName}-overlay-visible`, Boolean(before.button?.visible), before);
  const inViewport = Boolean(
    before.button?.visible &&
      before.button.top >= 0 &&
      before.button.bottom <= 844,
  );
  ok(`${shotName}-in-viewport-with-map`, inViewport, {
    button: before.button,
    mapTop: before.map?.top,
  });
  ok(`${shotName}-clear-of-basemap`, !before.overlapBasemap, {
    overlapBasemap: before.overlapBasemap,
    button: before.button,
    basemap: before.basemap,
  });
  ok(`${shotName}-not-above-header`, !before.aboveHeader, {
    aboveHeader: before.aboveHeader,
    buttonTop: before.button?.top,
    headerBottom: before.header?.bottom,
  });
  ok(`${shotName}-on-map`, before.insideMapViewport, before);

  const hb = await headerBottom(page);
  ok(`${shotName}-button-below-header`, (before.button?.top ?? 0) >= hb - 1, {
    buttonTop: before.button?.top,
    headerBottom: hb,
  });

  const wasPlaying = await readPlaying(page);
  await page.locator("[data-apex-map-play-toggle]").first().tap({
    timeout: 5000,
  });
  await page.waitForTimeout(400);
  const midPlaying = await readPlaying(page);
  ok(`${shotName}-single-tap-toggles`, midPlaying !== wasPlaying, {
    wasPlaying,
    midPlaying,
  });
  await page.locator("[data-apex-map-play-toggle]").first().tap({
    timeout: 5000,
  });
  await page.waitForTimeout(400);
  const afterPlaying = await readPlaying(page);
  ok(`${shotName}-single-tap-toggles-back`, afterPlaying === wasPlaying, {
    wasPlaying,
    afterPlaying,
  });

  const pov = page.getByRole("button", { name: /^POV$/i });
  if ((await pov.count()) > 0) {
    await pov.first().tap({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const mapTopPov = await page.evaluate(() => {
      const map =
        document.querySelector("[data-apex-map-stack]") ||
        document.querySelector("[data-apex-map]");
      return map?.getBoundingClientRect().top ?? 0;
    });
    if (mapTopPov > 200) {
      await page.evaluate(
        (y) => window.scrollBy(0, Math.max(0, y - 72)),
        mapTopPov,
      );
      await page.waitForTimeout(250);
    }
    const povLayout = await layoutProbe(page);
    ok(`${shotName}-pov-overlay-visible`, Boolean(povLayout.button?.visible), {
      povLayout,
    });
    ok(`${shotName}-pov-clear-of-basemap`, !povLayout.overlapBasemap, {
      overlapBasemap: povLayout.overlapBasemap,
    });
    ok(`${shotName}-pov-not-above-header`, !povLayout.aboveHeader, {
      aboveHeader: povLayout.aboveHeader,
      buttonTop: povLayout.button?.top,
      headerBottom: povLayout.header?.bottom,
    });
  } else {
    ok(`${shotName}-pov-overlay-visible`, false, "POV control missing");
    ok(`${shotName}-pov-clear-of-basemap`, false, "POV control missing");
    ok(`${shotName}-pov-not-above-header`, false, "POV control missing");
  }

  await page.evaluate(() => window.scrollBy(0, 420));
  await page.waitForTimeout(300);
  const scrolled = await layoutProbe(page);
  const hb2 = await headerBottom(page);
  // Off-screen above (top < 0) means the control scrolled away with the map —
  // that is correct. Fail only if it still paints over the sticky header band.
  const coveringHeader = Boolean(
    scrolled.button &&
      scrolled.button.width > 0 &&
      scrolled.button.bottom > 0 &&
      scrolled.button.top < hb2,
  );
  ok(`${shotName}-scroll-not-over-header`, !coveringHeader, {
    buttonTop: scrolled.button?.top,
    buttonBottom: scrolled.button?.bottom,
    headerBottom: hb2,
    coveringHeader,
  });

  // Reset scroll for screenshot of Play on map.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  const mapTopShot = await page.evaluate(() => {
    const map =
      document.querySelector("[data-apex-map-stack]") ||
      document.querySelector("[data-apex-map]");
    return map?.getBoundingClientRect().top ?? 0;
  });
  if (mapTopShot > 72) {
    await page.evaluate((y) => window.scrollBy(0, Math.max(0, y - 72)), mapTopShot);
    await page.waitForTimeout(200);
  }

  await page.screenshot({
    path: resolve(OUT, `${shotName}-390.png`),
    fullPage: false,
  });
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runPage(browser, `/sessions/${SESSION}`, "session");
  await runPage(browser, `/sessions/${SESSION}/compare`, "compare");
} finally {
  await browser.close();
}

const failed = Object.entries(proof.checks).filter(([, v]) => !v.pass);
writeFileSync(resolve(OUT, "proof.json"), JSON.stringify(proof, null, 2));
console.log(`\nWrote ${resolve(OUT, "proof.json")} (${failed.length} failed)`);
if (failed.length) process.exit(1);
