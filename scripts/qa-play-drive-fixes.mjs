/**
 * Browser proof for session Play clock, compare lap toggle-off, and Drive QA.
 *
 * Usage: BASE_URL=https://... node scripts/qa-play-drive-fixes.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
const SESSION = "1aa2fb88-8204-4abb-b745-520ea99819dd";
mkdirSync(OUT, { recursive: true });

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

async function readClock(page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-apex-playback-clock]");
    if (el) {
      return {
        at: Number(el.getAttribute("data-apex-playback-at") || "NaN"),
        total: Number(el.getAttribute("data-apex-playback-total") || "NaN"),
        text: (el.textContent || "").trim(),
      };
    }
    const groups = [...document.querySelectorAll("[role=group]")];
    const g = groups.find((node) =>
      /Lap playback|Playback|Play (both|all)/i.test(node.textContent || ""),
    );
    const mono = g?.querySelector(".font-mono");
    const text = mono?.textContent || "";
    const m = text.match(/(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/);
    return {
      at: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      text: text.slice(0, 80),
    };
  });
}

async function orangeBlobSize(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // orange car #f97316 ≈ rgb(249,115,22)
        if (r > 180 && g > 60 && g < 170 && b < 80) {
          count += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!count) return { count: 0 };
    return {
      count,
      w: maxX - minX,
      h: maxY - minY,
      minX,
      minY,
      maxX,
      maxY,
    };
  });
}

async function withShare(page) {
  // Optional Vercel protection share cookie from env.
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

const browser = await chromium.launch({ headless: true });

// ---------- 1) Session Play clock ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await withShare(page);
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const url = `${BASE}/sessions/${SESSION}?lap=6`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(8000);

  // Prefer lap 6 chip if present
  const lap6 = page.locator("button").filter({ hasText: /^6\b|L6\b/ }).first();
  if (await lap6.count()) {
    await lap6.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const play = page.locator("[data-apex-play-toggle]").first();
  await play.waitFor({ timeout: 30000 });
  const before = await readClock(page);
  await play.click();
  await page.waitForTimeout(500);
  const label = await play.getAttribute("aria-label");
  await page.waitForTimeout(2500);
  const mid = await readClock(page);
  await page.waitForTimeout(2500);
  const after = await readClock(page);
  await page.screenshot({
    path: resolve(OUT, "qa-play-clock-session.png"),
    fullPage: false,
  });

  const advanced =
    (after.at ?? 0) >= (before.at ?? 0) + 3.5 &&
    (mid.at ?? 0) > (before.at ?? 0) + 1.2;
  ok("1-play-clock-advances", advanced && label === "Pause", {
    before,
    mid,
    after,
    label,
    delta: (after.at ?? 0) - (before.at ?? 0),
  });
  ok(
    "1-play-no-critical-console",
    !consoleErrors.some((e) => /TypeError|ReferenceError|is not defined/i.test(e)),
    consoleErrors.slice(0, 8),
  );
  await page.close();
}

// ---------- 2) Compare lap toggle-off ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await withShare(page);
  await page.goto(`${BASE}/sessions/${SESSION}/compare`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(7000);

  // Ensure ≥3 selected: click unselected rows until Comparing (3/…
  for (let i = 0; i < 6; i += 1) {
    const count = await page.evaluate(() =>
      document.querySelectorAll("[data-apex-compare-chip]").length,
    );
    if (count >= 3) break;
    const unselected = page.locator('[role="option"][aria-selected="false"]');
    if ((await unselected.count()) === 0) break;
    await unselected.nth(0).click();
    await page.waitForTimeout(400);
  }

  const beforeChips = await page.evaluate(() =>
    [...document.querySelectorAll("[data-apex-compare-chip]")].map((el) =>
      el.getAttribute("data-apex-compare-chip"),
    ),
  );

  // Prefer Remove on a non-ref chip; else toggle a selected row off.
  const removeBtn = page.locator("[data-apex-compare-remove]").first();
  let removedKey = null;
  if ((await removeBtn.count()) > 0 && beforeChips.length > 2) {
    removedKey = await removeBtn.getAttribute("data-apex-compare-remove");
    await removeBtn.click();
  } else {
    const selected = page.locator('[role="option"][aria-selected="true"]');
    const n = await selected.count();
    if (n > 2) {
      // Click last selected (likely not ref)
      await selected.nth(n - 1).click();
      removedKey = await selected.nth(n - 1).evaluate((el) => {
        const label = el.textContent || "";
        return label.trim().slice(0, 40);
      });
    }
  }
  await page.waitForTimeout(800);
  const afterChips = await page.evaluate(() =>
    [...document.querySelectorAll("[data-apex-compare-chip]")].map((el) =>
      el.getAttribute("data-apex-compare-chip"),
    ),
  );
  await page.screenshot({
    path: resolve(OUT, "qa-compare-toggle-off.png"),
    fullPage: false,
  });

  const removed =
    beforeChips.length >= 3 &&
    afterChips.length === beforeChips.length - 1 &&
    (!removedKey ||
      !afterChips.includes(removedKey) ||
      afterChips.length < beforeChips.length);
  ok("2-compare-toggle-off", removed, {
    before: beforeChips,
    after: afterChips,
    removedKey,
  });
  await page.close();
}

// ---------- 3–6) Drive: car size, grass, timer, minimap ----------
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await withShare(page);
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(`${BASE}/drive/thunderhill-west`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(4000);
  const start = page.getByRole("button", { name: /Start driving/i });
  await start.waitFor({ timeout: 60000 });
  await start.click();
  await page.waitForTimeout(1200);

  // Hold throttle to get rolling
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: resolve(OUT, "qa-drive-chase-car.png"),
    fullPage: false,
  });
  const chaseBlob = await orangeBlobSize(page);

  // Top-down for tiny-dot regression
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: resolve(OUT, "qa-drive-top-car-minimap.png"),
    fullPage: false,
  });
  const topBlob = await orangeBlobSize(page);

  ok(
    "3-car-visible-chase",
    (chaseBlob?.w ?? 0) >= 16 && (chaseBlob?.h ?? 0) >= 16,
    chaseBlob,
  );
  ok(
    "3-car-visible-top",
    (topBlob?.w ?? 0) >= 14 && (topBlob?.h ?? 0) >= 14,
    topBlob,
  );

  // Minimap: dark rounded panel with track in corner — sample pixels near BR
  const minimap = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const x0 = Math.floor(width * 0.78);
    const y0 = Math.floor(height * 0.72);
    const data = ctx.getImageData(x0, y0, width - x0, height - y0).data;
    let dark = 0;
    let asphalt = 0;
    let orange = 0;
    for (let i = 0; i < data.length; i += 16) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < 40 && g < 40 && b < 45) dark += 1;
      if (r > 60 && r < 120 && Math.abs(r - g) < 25 && b < 120) asphalt += 1;
      if (r > 180 && g > 60 && g < 170 && b < 80) orange += 1;
    }
    return { dark, asphalt, orange, w: width - x0, h: height - y0 };
  });
  ok(
    "6-minimap-present",
    (minimap?.dark ?? 0) > 80 &&
      ((minimap?.asphalt ?? 0) > 20 || (minimap?.orange ?? 0) > 0),
    minimap,
  );

  // Grass: steer hard off track while throttling, then release and re-throttle
  await page.keyboard.press("KeyC"); // back to chase
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(3500);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(800);
  const onGrass = await page.locator("[data-apex-drive-on-track='0']").count();
  const grassMphWhileThrottle = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(1200);
  const coastMph = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(900);
  const crawlMph = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  await page.keyboard.up("ArrowUp");
  await page.screenshot({
    path: resolve(OUT, "qa-drive-grass.png"),
    fullPage: false,
  });

  ok(
    "4-grass-cap-low",
    onGrass > 0
      ? grassMphWhileThrottle <= 14 && coastMph <= 8
      : coastMph <= 12,
    {
      onGrass,
      grassMphWhileThrottle,
      coastMph,
      crawlMph,
    },
  );
  ok("4-grass-can-drive-off", crawlMph >= 3 || onGrass === 0, {
    crawlMph,
    onGrass,
  });

  // Lap timer monotonic for a short window (no false reset)
  const t0 = Number(
    (await page.locator("[data-apex-drive-lap]").getAttribute("data-apex-drive-lap-ms")) ||
      "0",
  );
  const samples = [t0];
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(400);
    samples.push(
      Number(
        (await page
          .locator("[data-apex-drive-lap]")
          .getAttribute("data-apex-drive-lap-ms")) || "0",
      ),
    );
  }
  let mono = true;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i] + 80 < samples[i - 1] && samples[i] > 500) {
      // Allow reset only near 0 after a finish
      mono = false;
    }
  }
  ok("5-lap-timer-monotonic", mono, { samples });

  // Mobile drive console check
  await page.close();
  const mobile = await browser.newPage({
    ...devices["iPhone 12"],
  });
  await withShare(mobile);
  const mobileErrors = [];
  mobile.on("pageerror", (err) => mobileErrors.push(String(err)));
  mobile.on("console", (msg) => {
    if (msg.type() === "error") mobileErrors.push(msg.text());
  });
  await mobile.goto(`${BASE}/drive/thunderhill-west`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await mobile.waitForTimeout(3500);
  await mobile.getByRole("button", { name: /Start driving/i }).click();
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({
    path: resolve(OUT, "qa-drive-mobile.png"),
    fullPage: false,
  });
  const mobileBlob = await orangeBlobSize(mobile);
  ok(
    "3-car-visible-mobile",
    (mobileBlob?.w ?? 0) >= 14 && (mobileBlob?.h ?? 0) >= 14,
    mobileBlob,
  );
  ok(
    "5-mobile-no-critical-console",
    !mobileErrors.some((e) => /TypeError|ReferenceError|is not defined/i.test(e)),
    mobileErrors.slice(0, 8),
  );
  await mobile.close();
}

await browser.close();

const failed = Object.values(proof.checks).filter((c) => !c.pass).length;
proof.failed = failed;
writeFileSync(resolve(OUT, "qa-play-drive-fixes.json"), JSON.stringify(proof, null, 2));
console.log(`\n${failed} failed — wrote ${OUT}/qa-play-drive-fixes.json`);
process.exit(failed ? 1 : 0);
