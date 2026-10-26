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
  // Sample the playfield only (skip HUD top + touch controls / minimap bottom).
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const { width, height } = canvas;
    const y0 = Math.floor(height * 0.18);
    const y1 = Math.floor(height * 0.72);
    const x0 = Math.floor(width * 0.15);
    const x1 = Math.floor(width * 0.85);
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 2) {
      for (let x = x0; x < x1; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // orange car #f97316 ≈ rgb(249,115,22)
        if (r > 200 && g > 70 && g < 160 && b < 70) {
          count += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!count) return { count: 0, region: { x0, x1, y0, y1 } };
    return {
      count,
      w: maxX - minX,
      h: maxY - minY,
      minX,
      minY,
      maxX,
      maxY,
      region: { x0, x1, y0, y1 },
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

// ---------- 2) Compare lap toggle-off (from default 2 chips) ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await withShare(page);
  await page.goto(`${BASE}/sessions/${SESSION}/compare`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector('[role="option"]', { timeout: 60000 });
  await page.waitForTimeout(2500);

  const chipCount = async () =>
    page.evaluate(
      () => document.querySelectorAll("[data-apex-compare-chip]").length,
    );
  const selectedLabels = async () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll('[role="option"][aria-selected="true"]'),
      ].map((el) => el.querySelector("span")?.textContent?.trim() || ""),
    );
  const chipTexts = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll("[data-apex-compare-chip]")].map((el) =>
        (el.textContent || "").replace(/\s+/g, " ").trim(),
      ),
    );

  // Trim to exactly two chips if a prior URL left more.
  for (let i = 0; i < 4; i += 1) {
    const n = await chipCount();
    if (n <= 2) break;
    const x = page.locator("[data-apex-compare-remove]").last();
    if ((await x.count()) === 0) break;
    await x.click();
    await page.waitForTimeout(350);
  }

  // Ensure L3 is one of the two (reported default pair is L6 ref + L3).
  const labelsBeforeEnsure = await selectedLabels();
  if (!labelsBeforeEnsure.includes("L3")) {
    const l3 = page.locator('[role="option"]').filter({ hasText: /^L3\b/ });
    if ((await l3.count()) > 0) {
      // If already at 2, remove a non-ref first via × then add L3.
      if ((await chipCount()) >= 2) {
        const nonRefX = page.locator(
          "[data-apex-compare-chip]:not(:has-text('Ref')) [data-apex-compare-remove]",
        );
        if ((await nonRefX.count()) > 0) await nonRefX.first().click();
        await page.waitForTimeout(350);
      }
      await l3.first().click();
      await page.waitForTimeout(400);
    }
  }

  const beforeChips = await chipCount();
  const beforeSelected = await selectedLabels();
  const beforeTexts = await chipTexts();

  // Click the selected L3 row — must deselect even when only 2/4.
  const l3Idx = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    return rows.findIndex((el) => {
      const label = el.querySelector("span")?.textContent?.trim() || "";
      return label === "L3" && el.getAttribute("aria-selected") === "true";
    });
  });
  ok(
    "2-compare-l3-selected-before",
    l3Idx >= 0 && beforeChips === 2,
    { beforeChips, beforeSelected, beforeTexts, l3Idx },
  );
  if (l3Idx < 0) throw new Error("L3 not selected before toggle");
  await page.locator('[role="option"]').nth(l3Idx).click();
  await page.waitForTimeout(900);
  let afterSelected = await selectedLabels();
  let afterChips = await chipCount();
  let afterTexts = await chipTexts();
  const l3Gone =
    !afterSelected.includes("L3") &&
    afterChips === beforeChips - 1 &&
    !afterTexts.some((t) => /\bL3\b/.test(t));

  // Stays deselected after settle (URL/default must not re-add).
  await page.waitForTimeout(1500);
  afterSelected = await selectedLabels();
  afterChips = await chipCount();
  afterTexts = await chipTexts();
  const stayedOff =
    !afterSelected.includes("L3") &&
    afterChips === 1 &&
    !afterTexts.some((t) => /\bL3\b/.test(t));
  await page.screenshot({
    path: resolve(OUT, "qa-compare-toggle-off.png"),
    fullPage: false,
  });
  ok("2-compare-toggle-off", l3Gone && stayedOff, {
    beforeChips,
    beforeSelected,
    afterChips,
    afterSelected,
    afterTexts,
    l3Gone,
    stayedOff,
    url: page.url(),
  });

  // Chip × remove + Set ref
  // Re-add L3, then set it as ref, then × remove the other.
  const l3Opt = page.locator('[role="option"]').filter({ hasText: /^L3\b/ });
  if ((await l3Opt.count()) > 0) {
    await l3Opt.first().click();
    await page.waitForTimeout(400);
  }
  const setRef = page.locator("[data-apex-compare-set-ref]").first();
  let refChanged = false;
  if ((await setRef.count()) > 0) {
    const key = await setRef.getAttribute("data-apex-compare-set-ref");
    await setRef.click();
    await page.waitForTimeout(400);
    const refChip = await page.evaluate((k) => {
      const chip = document.querySelector(
        `[data-apex-compare-chip="${k}"]`,
      );
      return (chip?.textContent || "").includes("Ref");
    }, key);
    refChanged = Boolean(refChip);
  }
  const removeBtn = page.locator("[data-apex-compare-remove]").first();
  const chipsBeforeX = await chipCount();
  if ((await removeBtn.count()) > 0 && chipsBeforeX > 1) {
    await removeBtn.click();
    await page.waitForTimeout(500);
  }
  const chipsAfterX = await chipCount();
  await page.screenshot({
    path: resolve(OUT, "qa-compare-chip-x-ref.png"),
    fullPage: false,
  });
  ok("2-compare-chip-x-and-ref", refChanged && chipsAfterX === chipsBeforeX - 1, {
    refChanged,
    chipsBeforeX,
    chipsAfterX,
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
  const chaseCarPx = Number(
    (await page
      .locator("[data-apex-drive-car-px]")
      .getAttribute("data-apex-drive-car-px")) || "0",
  );

  // Top-down for tiny-dot regression
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: resolve(OUT, "qa-drive-top-car-minimap.png"),
    fullPage: false,
  });
  const topBlob = await orangeBlobSize(page);
  const topCarPx = Number(
    (await page
      .locator("[data-apex-drive-car-px]")
      .getAttribute("data-apex-drive-car-px")) || "0",
  );

  ok(
    "3-car-visible-chase",
    chaseCarPx >= 50 && (chaseBlob?.count ?? 0) >= 20,
    { chaseCarPx, chaseBlob },
  );
  ok(
    "3-car-visible-top",
    topCarPx >= 50 && (topBlob?.count ?? 0) >= 8,
    { topCarPx, topBlob },
  );

  // Minimap: dark rounded panel top-right (moved off brake/gas).
  const minimap = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const sample = (x0, y0, x1, y1) => {
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
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
      return { dark, asphalt, orange, w: x1 - x0, h: y1 - y0 };
    };
    return {
      topRight: sample(
        Math.floor(width * 0.78),
        Math.floor(height * 0.02),
        width,
        Math.floor(height * 0.32),
      ),
      bottomRight: sample(
        Math.floor(width * 0.78),
        Math.floor(height * 0.72),
        width,
        height,
      ),
    };
  });
  ok(
    "6-minimap-present",
    (minimap?.topRight?.dark ?? 0) > 80 &&
      ((minimap?.topRight?.asphalt ?? 0) > 20 ||
        (minimap?.topRight?.orange ?? 0) > 0),
    minimap,
  );
  ok(
    "6-minimap-not-bottom-right",
    (minimap?.bottomRight?.dark ?? 0) < (minimap?.topRight?.dark ?? 0) * 0.5,
    minimap,
  );

  // Grass: shove off ribbon (KeyX), then measure cap / coast / crawl.
  await page.keyboard.press("KeyC"); // back to chase
  await page.keyboard.down("ArrowUp");
  await page.keyboard.press("KeyX");
  let onGrass = 0;
  let grassMphWhileThrottle = 0;
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(200);
    onGrass = await page.locator("[data-apex-drive-on-track='0']").count();
    grassMphWhileThrottle = Number(
      (await page
        .locator("[data-apex-drive-speed]")
        .getAttribute("data-apex-drive-mph")) || "0",
    );
    if (onGrass > 0) break;
    if (i === 8) await page.keyboard.press("KeyX");
  }
  // Keep steering into grass while measuring cap / coast / crawl.
  await page.waitForTimeout(700);
  grassMphWhileThrottle = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  onGrass = await page.locator("[data-apex-drive-on-track='0']").count();
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(1100);
  const coastMph = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  const onGrassCoast = await page.locator("[data-apex-drive-on-track='0']").count();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1000);
  const crawlMph = Number(
    (await page
      .locator("[data-apex-drive-speed]")
      .getAttribute("data-apex-drive-mph")) || "0",
  );
  const onGrassCrawl = await page.locator("[data-apex-drive-on-track='0']").count();
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("ArrowLeft");
  await page.screenshot({
    path: resolve(OUT, "qa-drive-grass.png"),
    fullPage: false,
  });

  ok(
    "4-grass-cap-low",
    onGrass > 0 &&
      grassMphWhileThrottle <= 12 &&
      (onGrassCoast === 0 || coastMph <= 6),
    {
      onGrass,
      grassMphWhileThrottle,
      coastMph,
      onGrassCoast,
      crawlMph,
      onGrassCrawl,
    },
  );
  ok(
    "4-grass-can-drive-off",
    onGrassCrawl > 0 && crawlMph >= 3 && crawlMph <= 12,
    { crawlMph, onGrassCrawl },
  );

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

  // Measure: minimap top-right must not overlap Brake/Gas hit boxes.
  const layout = await mobile.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const buttons = [...document.querySelectorAll("button")].filter((b) =>
      /^(Brake|Gas)$/i.test((b.textContent || "").trim()),
    );
    if (!canvas || buttons.length < 2) {
      return { ok: false, reason: "missing canvas or buttons" };
    }
    const c = canvas.getBoundingClientRect();
    const btnBoxes = buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return { label: b.textContent.trim(), x: r.x, y: r.y, r: r.right, b: r.bottom };
    });
    // Expected minimap: ~size 96–148, pad 10, top ≈ 68 on mobile width.
    const size = Math.max(96, Math.min(148, Math.floor(c.width * 0.22)));
    const mini = {
      x: c.right - size - 10,
      y: c.top + 10 + 58,
      r: c.right - 10,
      b: c.top + 10 + 58 + size,
    };
    const overlaps = btnBoxes.some(
      (b) => !(b.r < mini.x || b.x > mini.r || b.b < mini.y || b.y > mini.b),
    );
    // Minimap dark panel should be in top-right of canvas pixels.
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const x0 = Math.floor(width * 0.72);
    const y0 = Math.floor(height * 0.05);
    const y1 = Math.floor(height * 0.38);
    const data = ctx.getImageData(x0, y0, width - x0, y1 - y0).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 16) {
      if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 45) dark += 1;
    }
    return { ok: true, overlaps, mini, btnBoxes, dark, size };
  });
  await mobile.screenshot({
    path: resolve(OUT, "qa-drive-mobile-minimap-top.png"),
    fullPage: false,
  });
  ok(
    "6-mobile-minimap-clear-of-pedals",
    layout.ok && !layout.overlaps && (layout.dark ?? 0) > 40,
    layout,
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
