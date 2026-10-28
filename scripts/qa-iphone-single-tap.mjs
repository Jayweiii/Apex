/**
 * Touch-emulated Playwright: ONE tap must fire click on buttons/links
 * across home, upload, session, compare, Drive.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 node scripts/qa-iphone-single-tap.mjs
 *   BASE_URL=https://apex-ashy-beta.vercel.app node scripts/qa-iphone-single-tap.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT =
  process.env.OUT_DIR || resolve("/opt/cursor/artifacts/iphone-single-tap");
mkdirSync(OUT, { recursive: true });

const SESSION =
  process.env.APEX_SESSION_ID || "340f914a-49f7-4c6e-bccc-33a3fe2de689";
const COMPARE =
  process.env.APEX_COMPARE_ID || "b3d74813-1ad5-4786-a47a-887cc049b60e";
const DRIVE_TRACK = process.env.APEX_DRIVE_TRACK || "thunderhill-west";

const proof = {
  base: BASE,
  at: new Date().toISOString(),
  sha: process.env.EXPECT_SHA || null,
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

async function withShare(page) {
  const share = process.env.VERCEL_SHARE || process.env.VERCEL_SHARE_COOKIE;
  if (!share) return;
  const url = new URL(BASE);
  await page.context().addCookies([
    {
      name: "_vercel_share",
      value: share.replace(/^_vercel_share=/, ""),
      domain: url.hostname,
      path: "/",
    },
  ]);
}

/** One finger tap; assert a click event fires exactly once on the target. */
async function assertSingleTapClick(page, locator, name) {
  const el = locator.first();
  await el.waitFor({ state: "visible", timeout: 30000 });
  const box = await el.boundingBox();
  if (!box) {
    ok(name, false, "no bounding box");
    return false;
  }

  const handle = await el.elementHandle();
  if (!handle) {
    ok(name, false, "no element handle");
    return false;
  }

  await page.evaluate((node) => {
    node.dataset.apexTapClicks = "0";
    node.addEventListener(
      "click",
      () => {
        node.dataset.apexTapClicks = String(
          Number(node.dataset.apexTapClicks || "0") + 1,
        );
      },
      { capture: true },
    );
  }, handle);

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(150);

  const clicks = await page.evaluate(
    (node) => Number(node.dataset.apexTapClicks || "0"),
    handle,
  );
  const touchAction = await page.evaluate(
    (node) => getComputedStyle(node).touchAction,
    handle,
  );

  const pass = clicks === 1;
  ok(name, pass, { clicks, touchAction, x: Math.round(x), y: Math.round(y) });
  return pass;
}

const iPhone = devices["iPhone 13"];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  ...iPhone,
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
await withShare(page);

let failures = 0;

{
  await page.goto(`${BASE}/`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const media = await page.evaluate(() => ({
    hoverHover: window.matchMedia("(hover: hover)").matches,
    pointerFine: window.matchMedia("(pointer: fine)").matches,
    hoverNone: window.matchMedia("(hover: none)").matches,
    pointerCoarse: window.matchMedia("(pointer: coarse)").matches,
  }));
  ok(
    "iphone-media-no-fine-hover",
    media.pointerFine === false && media.hoverHover === false,
    media,
  );
  if (media.pointerFine || media.hoverHover) failures += 1;

  const sticky = await page.evaluate(() => {
    let invalidMedia = 0;
    let gatedHoverUtils = 0;
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        const text = rule.cssText || "";
        if (text.includes("(hover: hover) and (pointer: fine):hover")) {
          invalidMedia += 1;
        }
        if (
          rule.type === CSSRule.MEDIA_RULE &&
          /hover:\s*hover/.test(rule.conditionText) &&
          /pointer:\s*fine/.test(rule.conditionText)
        ) {
          gatedHoverUtils += 1;
        }
      }
    }
    return { invalidMedia, gatedHoverUtils };
  });
  ok("css-no-invalid-hover-media", sticky.invalidMedia === 0, sticky);
  if (sticky.invalidMedia !== 0) failures += 1;
  ok(
    "css-gated-hover-media-present",
    sticky.gatedHoverUtils > 0,
    sticky,
  );
  if (sticky.gatedHoverUtils <= 0) failures += 1;
}

{
  await page.goto(`${BASE}/`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("a.apex-btn, button.apex-btn", { timeout: 60000 });
  if (
    !(await assertSingleTapClick(
      page,
      page.locator('a.apex-btn[href="/upload"]').first(),
      "home-upload-cta-single-tap",
    ))
  ) {
    failures += 1;
  }
  const menu = page.locator('button[aria-label="Open menu"]');
  if ((await menu.count()) > 0) {
    await menu.first().tap();
    await page.waitForTimeout(200);
  }
  if (
    !(await assertSingleTapClick(
      page,
      page
        .locator('nav[aria-label="Mobile"] a.apex-nav-link[href="/drive"]')
        .first(),
      "home-mobile-nav-drive-single-tap",
    ))
  ) {
    failures += 1;
  }
  await page.screenshot({
    path: resolve(OUT, "home-iphone.png"),
    fullPage: false,
  });
}

{
  await page.goto(`${BASE}/upload`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("button, a.apex-btn, label", { timeout: 60000 });
  const uploadBtn = page
    .locator("button.apex-btn, label[for], button[type='submit']")
    .filter({ hasText: /upload|choose|browse|select|continue|sign/i })
    .first();
  const fallback = page.locator("button.apex-btn, a.apex-btn").first();
  const target = (await uploadBtn.count()) > 0 ? uploadBtn : fallback;
  if (!(await assertSingleTapClick(page, target, "upload-primary-single-tap"))) {
    failures += 1;
  }
  await page.screenshot({
    path: resolve(OUT, "upload-iphone.png"),
    fullPage: false,
  });
}

{
  await page.goto(`${BASE}/sessions/${SESSION}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(2500);
  const sessionTarget = page
    .locator(
      "button.apex-btn, a.apex-btn, button[data-apex-speed-unit-toggle], [role='button'].apex-pressable",
    )
    .first();
  if (
    !(await assertSingleTapClick(
      page,
      sessionTarget,
      "session-control-single-tap",
    ))
  ) {
    failures += 1;
  }
  await page.screenshot({
    path: resolve(OUT, "session-iphone.png"),
    fullPage: false,
  });
}

{
  await page.goto(`${BASE}/compare/${COMPARE}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(3000);
  const compareTarget = page
    .locator(
      "button.apex-btn, a.apex-btn, button[data-apex-speed-unit-toggle], [role='option'], button[aria-pressed]",
    )
    .first();
  if (
    !(await assertSingleTapClick(
      page,
      compareTarget,
      "compare-control-single-tap",
    ))
  ) {
    failures += 1;
  }
  await page.screenshot({
    path: resolve(OUT, "compare-iphone.png"),
    fullPage: false,
  });
}

{
  await page.goto(`${BASE}/drive/${DRIVE_TRACK}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector(
    "[data-apex-drive-start], a.apex-btn, button.apex-btn",
    { timeout: 90000 },
  );
  const driveStart = page.locator("[data-apex-drive-start]");
  const driveTarget =
    (await driveStart.count()) > 0
      ? driveStart
      : page.locator("button.apex-btn, a.apex-btn").first();
  if (
    !(await assertSingleTapClick(page, driveTarget, "drive-start-single-tap"))
  ) {
    failures += 1;
  }
  await page.screenshot({
    path: resolve(OUT, "drive-iphone.png"),
    fullPage: false,
  });
}

await browser.close();

const passed = Object.values(proof.checks).filter((c) => c.pass).length;
const total = Object.keys(proof.checks).length;
proof.summary = { passed, total, failures };
writeFileSync(resolve(OUT, "proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof.summary));
if (failures > 0 || passed < total) process.exit(1);
