/**
 * Final browser proof for re-QA remaining items (393 + 1280).
 * Writes measured JSON + screenshots to /opt/cursor/artifacts/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });
const SESSION_B = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const COMPARE = `${BASE}/sessions/${SESSION_B}/compare`;
const SESSION = `${BASE}/sessions/${SESSION_B}`;
const EXPECT_SHA = process.env.EXPECT_SHA || "";

const proof = {
  base: BASE,
  expectSha: EXPECT_SHA || null,
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

async function readClock(page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-apex-playback-clock]");
    if (el) {
      const at = Number(el.getAttribute("data-apex-playback-at"));
      const total = Number(el.getAttribute("data-apex-playback-total"));
      return {
        at: Number.isFinite(at) ? at : null,
        total: Number.isFinite(total) ? total : null,
        text: el.textContent?.trim() || null,
        via: "data-attr",
      };
    }
    const toggle = document.querySelector("[data-apex-play-toggle]");
    const group = toggle?.closest("[role=group]");
    const m = (group?.innerText || "").match(
      /(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/,
    );
    return {
      at: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      text: m?.[0] || null,
      via: "text",
    };
  });
}

async function setScrub(page, value0to1000) {
  const scrub = page.locator("input[type=range]").first();
  await scrub.waitFor({ timeout: 20000 });
  await scrub.evaluate((el, v) => {
    const desc = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    );
    desc.set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value0to1000);
  await page.waitForTimeout(500);
}

async function measurePlots(page, scope = "compare") {
  return page.evaluate((scopeName) => {
    const sels =
      scopeName === "compare"
        ? ["[data-apex-compare-chart]"]
        : [
            '[data-apex-chart-plot="channel"]',
            '[data-apex-chart-plot^="g-"]',
            "[data-apex-chart-plot]",
            ".recharts-responsive-container",
          ];
    const roots = [];
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) roots.push(el);
    }
    const seen = new Set();
    const out = [];
    for (const root of roots) {
      const host =
        root.querySelector?.("[data-apex-chart-plot]") ||
        (root.matches?.("[data-apex-chart-plot]") ? root : root);
      const key = host;
      if (seen.has(key)) continue;
      seen.add(key);
      const title =
        root.querySelector?.("p")?.textContent?.trim() ||
        host.getAttribute?.("data-apex-chart-plot") ||
        "?";
      const grid = host.querySelector?.(".recharts-cartesian-grid");
      const clip = host.querySelector?.("clipPath rect, defs clipPath rect");
      const gridBox = grid?.getBoundingClientRect();
      let plotH = gridBox?.height || 0;
      let source = "grid";
      if (!plotH && clip) {
        plotH = Number(clip.getAttribute("height") || 0);
        source = "clip";
      }
      if (!plotH) continue;
      out.push({
        title,
        hostH: host.getBoundingClientRect?.().height ?? null,
        plotH,
        source,
        clipH: clip ? Number(clip.getAttribute("height") || 0) : null,
      });
    }
    return out;
  }, scope);
}

const browser = await chromium.launch({ headless: true });

// -------- 1. Play / seek / Time↔Distance (1280) --------
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(COMPARE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("[data-apex-play-toggle]", { timeout: 60000 });
  await page.waitForTimeout(5000);

  const c0 = await readClock(page);
  await setScrub(page, 400);
  const cScrub = await readClock(page);

  const plot = page.locator('[data-apex-chart-plot="compare"]').first();
  await plot.scrollIntoViewIfNeeded();
  const box = await plot.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await page.waitForTimeout(600);
  const cClick = await readClock(page);

  await page.locator("[data-apex-play-toggle]").first().click();
  await page.waitForTimeout(2500);
  const cPlay = await readClock(page);
  const playing = await page
    .locator("[data-apex-play-toggle]")
    .first()
    .getAttribute("aria-label");
  await page.locator("[data-apex-play-toggle]").first().click();
  await page.waitForTimeout(300);
  const beforeToggle = await readClock(page);
  await page.getByRole("button", { name: /^Distance$/i }).first().click();
  await page.waitForTimeout(900);
  const afterDist = await readClock(page);
  await page.getByRole("button", { name: /^Time$/i }).first().click();
  await page.waitForTimeout(700);
  const afterTime = await readClock(page);

  const seekOk = (cScrub.at ?? 0) > 20 && (cClick.at ?? 0) > 20;
  const playOk = (cPlay.at ?? 0) >= (cClick.at ?? 0) + 1.5;
  const keepOk =
    beforeToggle.at != null &&
    afterDist.at != null &&
    afterTime.at != null &&
    Math.abs(afterDist.at - beforeToggle.at) < 2.5 &&
    Math.abs(afterTime.at - beforeToggle.at) < 2.5;

  ok("1-play-seek-and-axis-keep", seekOk && playOk && keepOk, {
    c0,
    cScrub,
    cClick,
    cPlay,
    playing,
    beforeToggle,
    afterDist,
    afterTime,
  });
  await page.screenshot({
    path: resolve(OUT, "reqa-final-play-1280.png"),
    fullPage: false,
  });
  await page.close();
}

// -------- 1b. Play from zero on iPhone 393 --------
{
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    viewport: { width: 393, height: 852 },
  });
  await page.goto(COMPARE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("[data-apex-play-toggle]", { timeout: 60000 });
  await page.waitForTimeout(5000);
  const c0 = await readClock(page);
  await page.locator("[data-apex-play-toggle]").first().click();
  await page.waitForTimeout(2500);
  const cPlay = await readClock(page);
  ok(
    "1b-iphone-play-from-zero",
    (c0.at ?? 0) < 0.5 && (cPlay.at ?? 0) >= 1.5,
    { c0, cPlay },
  );
  await setScrub(page, 500);
  const cScrub = await readClock(page);
  ok("1c-iphone-scrub", (cScrub.at ?? 0) > 30, { cScrub });
  await page.screenshot({
    path: resolve(OUT, "reqa-final-play-393.png"),
    fullPage: false,
  });
  await page.close();
}

// -------- 2. Plot areas ≥200 at 393 (compare + session) --------
{
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    viewport: { width: 393, height: 852 },
  });
  await page.goto(COMPARE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(7000);
  await page.locator("[data-apex-compare-chart]").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const comparePlots = await measurePlots(page, "compare");
  const compareMin = Math.min(...comparePlots.map((p) => p.plotH || 0), Infinity);
  ok(
    "2a-compare-plots-ge-200",
    comparePlots.length > 0 && comparePlots.every((p) => (p.plotH || 0) >= 200),
    { compareMin, comparePlots },
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-final-compare-plots-393.png"),
    fullPage: false,
  });
  await page.close();
}
{
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    viewport: { width: 393, height: 852 },
  });
  await page.goto(SESSION, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(7000);
  // Scroll telemetry into view
  const speed = page.locator("[data-apex-chart-plot]").first();
  if (await speed.count()) await speed.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const sessionPlots = await measurePlots(page, "session");
  const sessionMin = Math.min(
    ...sessionPlots.map((p) => p.plotH || 0),
    Infinity,
  );
  ok(
    "2b-session-plots-ge-200",
    sessionPlots.length > 0 &&
      sessionPlots.every((p) => (p.plotH || 0) >= 200),
    { sessionMin, sessionPlots },
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-final-session-plots-393.png"),
    fullPage: true,
  });
  await page.close();
}

// -------- 3. Session best badge + 4. GPS JUMP --------
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(SESSION, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const badges = [
      ...document.querySelectorAll("[data-apex-session-best]"),
    ].map((e) => e.textContent?.trim());
    const body = document.body.innerText;
    const list = body
      .match(/LAP TIMES[\s\S]{0,1600}/i)?.[0]
      ?.replace(/\s+/g, " ")
      .slice(0, 1000);
    const lap6HasJump = /06\s+1:34\.715\s+GPS JUMP/i.test(body.replace(/\s+/g, " "));
    const gpsJumpCount = [...body.matchAll(/GPS jump/gi)].length;
    const header = {
      h2: document
        .querySelector('section[aria-label^="Lap"] h2')
        ?.textContent?.trim(),
      time: document
        .querySelector('section[aria-label^="Lap"] .font-mono')
        ?.textContent?.trim(),
    };
    return { badges, gpsJumpCount, lap6HasJump, list, header };
  });
  ok(
    "3-session-best-badge",
    (info.badges || []).some((t) => /Session best/i.test(t || "")) &&
      /Lap\s*6/i.test(info.header.h2 || "") &&
      /1:34\.715/.test(info.header.time || ""),
    info,
  );
  ok("4-lap6-not-gps-jump", !info.lap6HasJump, info);
  await page.screenshot({
    path: resolve(OUT, "reqa-final-session-best.png"),
    fullPage: false,
  });
  await page.close();
}

await browser.close();

const allPass = Object.values(proof.checks).every((c) => c.pass);
proof.ok = allPass;
writeFileSync(resolve(OUT, "reqa-final-proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ ok: allPass, file: `${OUT}/reqa-final-proof.json` }));
process.exit(allPass ? 0 : 1);
