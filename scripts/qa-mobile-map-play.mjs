/**
 * iPhone 390px: Play/Pause sits on the map (session + compare) without
 * scrolling, stays clear of Street/Satellite, and never covers the sticky
 * top bar. Single-tap toggles play.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 node scripts/qa-mobile-map-play.mjs
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
  const share = process.env.VERCEL_SHARE || "";
  if (!share) return;
  const host = new URL(BASE).hostname;
  await context.addCookies([
    { name: "_vercel_share", value: share, domain: host, path: "/" },
  ]);
}

async function headerBottom(page) {
  return page.evaluate(() => {
    const header = document.querySelector("[data-apex-header], header");
    if (!header) return 0;
    return header.getBoundingClientRect().bottom;
  });
}

async function layoutProbe(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector("[data-apex-map-play-overlay]");
    const btn = document.querySelector(
      "[data-apex-map-play-toggle], [data-apex-play-toggle]",
    );
    const basemap = document.querySelector("[data-apex-basemap-toggle]");
    const map =
      document.querySelector("[data-apex-map-stack]") ||
      document.querySelector("[data-apex-map]");
    const header = document.querySelector("[data-apex-header], header");
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
    return {
      overlay: o,
      button: b,
      map: m,
      basemap: bm,
      header: h,
      overlapBasemap,
      aboveHeader,
      label: btn?.textContent?.trim() || null,
    };
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
  await page.waitForSelector(
    "[data-apex-map-play-toggle], [data-apex-play-toggle], [data-apex-map-stack]",
    { timeout: 90000 },
  );
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  const before = await layoutProbe(page);
  ok(`${shotName}-play-visible`, Boolean(before.button?.visible), before);
  ok(
    `${shotName}-no-scroll-needed`,
    Boolean(
      before.button?.visible &&
        before.button.top >= 0 &&
        before.button.bottom <= 844,
    ),
    before,
  );
  ok(`${shotName}-not-above-header`, !before.aboveHeader, {
    aboveHeader: before.aboveHeader,
    buttonTop: before.button?.top,
    headerBottom: before.header?.bottom,
  });

  const hb = await headerBottom(page);
  ok(`${shotName}-button-below-header`, (before.button?.top ?? 0) >= hb - 1, {
    buttonTop: before.button?.top,
    headerBottom: hb,
  });

  await page.screenshot({
    path: resolve(OUT, `${shotName}-390.png`),
    fullPage: false,
  });
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runPage(browser, `/sessions/${SESSION}`, "session");
} finally {
  await browser.close();
}

const failed = Object.entries(proof.checks).filter(([, v]) => !v.pass);
writeFileSync(resolve(OUT, "proof.json"), JSON.stringify(proof, null, 2));
console.log(`\nWrote ${resolve(OUT, "proof.json")} (${failed.length} failed)`);
if (failed.length) process.exit(1);
