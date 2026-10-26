/**
 * Reproduce remaining failures on prod Session 2 L6 vs L3.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });
const SESSION_B = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const COMPARE = `${BASE}/sessions/${SESSION_B}/compare`;

const proof = { base: BASE, at: new Date().toISOString(), checks: {} };

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
    const groups = [...document.querySelectorAll("[role=group]")];
    const g = groups.find((el) =>
      /Play (both|all)|Lap playback|Playback/i.test(el.textContent || ""),
    );
    const mono = g?.querySelector(".font-mono");
    const text = mono?.textContent || g?.textContent || "";
    const m = text.match(/(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/);
    return {
      text: text.slice(0, 80),
      at: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
    };
  });
}

async function measurePlots(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-apex-compare-chart]")];
    return cards.map((card) => {
      const title = card.querySelector("p")?.textContent?.trim() || "?";
      const host = card.querySelector('[data-apex-chart-plot="compare"]');
      const surface = host?.querySelector(".recharts-surface");
      const grid = host?.querySelector(".recharts-cartesian-grid");
      const gridRect = grid?.querySelector("rect");
      const clipRect = host?.querySelector("clipPath rect, defs clipPath rect");
      const hostBox = host?.getBoundingClientRect();
      const surfaceBox = surface?.getBoundingClientRect();
      const gridBox = grid?.getBoundingClientRect();
      let plotH = gridBox?.height || 0;
      let source = "grid";
      if (!plotH && gridRect) {
        plotH = Number(gridRect.getAttribute("height") || 0);
        source = "grid-attr";
      }
      if (!plotH && clipRect) {
        plotH = Number(clipRect.getAttribute("height") || 0);
        source = "clip";
      }
      return {
        title,
        hostH: hostBox?.height ?? null,
        surfaceH: surfaceBox?.height ?? null,
        gridH: gridBox?.height ?? null,
        plotH,
        source,
        clipH: clipRect ? Number(clipRect.getAttribute("height") || 0) : null,
        gridAttrH: gridRect
          ? Number(gridRect.getAttribute("height") || 0)
          : null,
      };
    });
  });
}

const browser = await chromium.launch({ headless: true });

// ---- Desktop 1280: play + seek ----
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(COMPARE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(7000);

  const comparing = await page.evaluate(() =>
    (document.body.innerText || "")
      .match(/COMPARING[\s\S]{0,400}/)?.[0]
      ?.replace(/\s+/g, " ")
      .slice(0, 300),
  );
  console.log("comparing:", comparing);

  const clock0 = await readClock(page);
  console.log("clock0", clock0);

  const scrub = page.locator('input[type="range"]').first();
  await scrub.waitFor({ timeout: 15000 });
  await scrub.evaluate((el) => {
    el.value = "400";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(800);
  const clockScrub = await readClock(page);

  await scrub.fill("600");
  await page.waitForTimeout(500);
  const clockFill = await readClock(page);

  const plot = page.locator('[data-apex-chart-plot="compare"]').first();
  const box = await plot.boundingBox();
  if (box) {
    await page.mouse.click(
      box.x + box.width * 0.55,
      box.y + box.height * 0.5,
    );
    await page.waitForTimeout(600);
  }
  const clockClick = await readClock(page);

  const play = page.locator("[data-apex-play-toggle]").first();
  await play.click();
  await page.waitForTimeout(2500);
  const clockPlay = await readClock(page);
  const playing = await play.getAttribute("aria-label");
  await play.click();
  await page.waitForTimeout(300);
  const clockPause = await readClock(page);

  const beforeToggle = await readClock(page);
  await page.getByRole("button", { name: /^Distance$/i }).first().click();
  await page.waitForTimeout(1000);
  const afterDist = await readClock(page);
  await page.getByRole("button", { name: /^Time$/i }).first().click();
  await page.waitForTimeout(800);
  const afterTime = await readClock(page);

  ok(
    "play-seek",
    (clockScrub.at ?? 0) > 5 ||
      (clockFill.at ?? 0) > 5 ||
      (clockClick.at ?? 0) > 5 ||
      ((clockPlay.at ?? 0) > (clock0.at || 0) + 0.5),
    {
      clock0,
      clockScrub,
      clockFill,
      clockClick,
      clockPlay,
      clockPause,
      playing,
      beforeToggle,
      afterDist,
      afterTime,
      comparing,
    },
  );

  await page.screenshot({
    path: resolve(OUT, "reqa2-desktop-play.png"),
    fullPage: false,
  });
  await page.close();
}

// ---- 393 plot heights ----
{
  const page = await browser.newPage({
    ...devices["iPhone 13"],
    viewport: { width: 393, height: 852 },
  });
  await page.goto(COMPARE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(7000);
  const chart = page.locator("[data-apex-compare-chart]").first();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  const plots = await measurePlots(page);
  const minPlot = Math.min(...plots.map((p) => p.plotH || 0));
  ok(
    "plot-ge-200",
    plots.length > 0 && plots.every((p) => (p.plotH || 0) >= 200),
    { minPlot, plots },
  );
  await page.screenshot({
    path: resolve(OUT, "reqa2-iphone-plots.png"),
    fullPage: false,
  });
  await page.close();
}

// ---- Session best badge + GPS JUMP ----
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto(`${BASE}/sessions/${SESSION_B}`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const bestBadge = [
      ...document.querySelectorAll("[data-apex-session-best]"),
    ].map((e) => e.textContent?.trim());
    const body = document.body.innerText;
    const gpsJumpMentions = [...body.matchAll(/GPS jump/gi)].length;
    const listText = body
      .match(/LAPS[\s\S]{0,1500}/i)?.[0]
      ?.replace(/\s+/g, " ")
      .slice(0, 900);
    const header = {
      h2: document
        .querySelector('section[aria-label^="Lap"] h2')
        ?.textContent?.trim(),
      time: document
        .querySelector('section[aria-label^="Lap"] .font-mono')
        ?.textContent?.trim(),
      badges: bestBadge,
    };
    return { bestBadge, gpsJumpMentions, listText, header };
  });
  ok(
    "session-best-badge",
    (info.bestBadge || []).some((t) => /Session best/i.test(t || "")),
    info,
  );
  ok("gps-jump-observe", true, info);
  await page.screenshot({
    path: resolve(OUT, "reqa2-session-best.png"),
    fullPage: false,
  });
  await page.close();
}

await browser.close();
writeFileSync(resolve(OUT, "reqa2-repro.json"), JSON.stringify(proof, null, 2));
console.log("wrote", resolve(OUT, "reqa2-repro.json"));
process.exit(Object.values(proof.checks).every((c) => c.pass) ? 0 : 1);
