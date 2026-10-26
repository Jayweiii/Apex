/**
 * Live re-QA of remaining failures against prod (393px + 1280px).
 * Writes measured proof JSON + screenshots to /opt/cursor/artifacts/.
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });

const SESSION_A = "340f914a-49f7-4c6e-bccc-33a3fe2de689";
const SESSION_B = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const COMPARE = `${BASE}/sessions/${SESSION_A}/compare`;
const EXPECT_SHA = process.env.EXPECT_SHA || "b95889b";

const results = {
  base: BASE,
  expectSha: EXPECT_SHA,
  at: new Date().toISOString(),
  checks: {},
};

function ok(name, pass, detail) {
  results.checks[name] = { pass: Boolean(pass), detail: detail ?? null };
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function readClock(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll("[role=group]")];
    const g = groups.find((el) =>
      /Playback|Lap playback/i.test(el.textContent || ""),
    );
    const m = (g?.textContent || "").match(
      /(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/,
    );
    return m ? { at: Number(m[1]), total: Number(m[2]) } : null;
  });
}

async function measurePlot(page) {
  return page.evaluate(() => {
    const card = document.querySelector("[data-apex-compare-chart]");
    const plotHost = document.querySelector('[data-apex-chart-plot="compare"]');
    const grid = document.querySelector(".recharts-cartesian-grid");
    const surface = document.querySelector(
      '[data-apex-chart-plot="compare"] .recharts-surface',
    );
    const gridBox = grid?.getBoundingClientRect();
    const hostBox = plotHost?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    // Prefer cartesian grid (true plot); fall back to clipPath rect.
    let plotH = gridBox?.height ?? 0;
    if (!plotH) {
      const clip = document.querySelector(
        '[data-apex-chart-plot="compare"] .recharts-cartesian-grid rect, [data-apex-chart-plot="compare"] clipPath rect',
      );
      plotH = clip ? Number(clip.getAttribute("height") || 0) : 0;
    }
    return {
      cardH: cardBox?.height ?? null,
      hostH: hostBox?.height ?? null,
      surfaceH: surface?.getBoundingClientRect().height ?? null,
      plotH,
      gridH: gridBox?.height ?? null,
    };
  });
}

async function deltaSeriesStats(page) {
  return page.evaluate(() => {
    const paths = [
      ...document.querySelectorAll(
        '[data-apex-compare-chart] .recharts-line-curve',
      ),
    ];
    // Find Delta card's paths
    const cards = [...document.querySelectorAll("[data-apex-compare-chart]")];
    const deltaCard = cards.find((c) =>
      /Delta/i.test(c.querySelector("p")?.textContent || ""),
    );
    const curves = deltaCard
      ? [...deltaCard.querySelectorAll(".recharts-line-curve")]
      : paths;
    const samples = curves.slice(0, 3).map((el) => {
      const d = el.getAttribute("d") || "";
      const ys = [...d.matchAll(/[, ](-?\d+(?:\.\d+)?)/g)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n));
      // crude: y coords alternate in path roughly — use uniqueness
      const uniq = new Set(ys.map((y) => Math.round(y)));
      return { len: d.length, uniqY: uniq.size, sampleYs: ys.slice(0, 12) };
    });
    // Read y-axis ticks on delta chart
    const ticks = deltaCard
      ? [...deltaCard.querySelectorAll(".recharts-yAxis .recharts-cartesian-axis-tick-value")]
          .map((t) => (t.textContent || "").trim())
          .filter(Boolean)
      : [];
    return { curves: samples, yTicks: ticks };
  });
}

const browser = await chromium.launch({ headless: true });

// ---------- 1280px compare: delta, distance, POV gaps ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(COMPARE, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(6000);

  // Scrub mid-lap so gaps/delta are interesting
  const scrub = page.locator('input[type="range"]').first();
  if (await scrub.count()) {
    await scrub.evaluate((el) => {
      el.value = "0.35";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(800);
  }

  const clockMid = await readClock(page);
  const gaps = await page.locator(".apex-car-marker__gap").allTextContents();
  const gapNums = gaps
    .map((g) => Number(String(g).replace(/[^0-9.\-]/g, "")))
    .filter((n) => Number.isFinite(n));

  // 1. Delta not −elapsed: sample tooltip / series + y ticks shouldn't be 0..−95
  const deltaStats = await deltaSeriesStats(page);
  const yNums = deltaStats.yTicks
    .map((t) => Number(String(t).replace(/[^0-9.\-]/g, "")))
    .filter((n) => Number.isFinite(n));
  const looksLikeNegElapsed =
    yNums.length >= 2 &&
    Math.min(...yNums) < -60 &&
    Math.max(...yNums) > -5 &&
    Math.max(...yNums) - Math.min(...yNums) > 50;
  const deltaVaried = deltaStats.curves.some((c) => c.uniqY >= 4);
  ok(
    "1-delta-not-minus-elapsed",
    !looksLikeNegElapsed && deltaVaried,
    JSON.stringify({
      yTicks: deltaStats.yTicks,
      looksLikeNegElapsed,
      curves: deltaStats.curves,
      clock: clockMid,
    }),
  );

  // Switch POV and count gap labels (need 2+ cars → ≥1; with 2 cars expect 1;
  // with 3+ expect n-1). Seed compare usually has 2 — add another if possible.
  const pov = page.getByRole("button", { name: /^POV$/i }).first();
  if (await pov.count()) {
    await pov.click();
    await page.waitForTimeout(1500);
  }
  // Try to ensure ≥2 compared laps already present
  const gapCount = await page.locator(".apex-car-marker__gap").count();
  const carDots = await page.locator(".apex-car-marker__dot").count();
  const expectedGaps = Math.max(0, carDots - 1);
  ok(
    "3-pov-gap-per-non-ref",
    carDots >= 2 && gapCount >= expectedGaps && gapCount >= 1,
    `gaps=${gapCount} cars=${carDots} expectedNonRef=${expectedGaps} texts=${JSON.stringify(gaps)}`,
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-1280-pov-gaps.png"),
    fullPage: false,
  });

  // 2. Distance axis: charts stay populated; clock not reset to 0
  // Seek first so we have a non-zero clock
  if (await scrub.count()) {
    await scrub.evaluate((el) => {
      el.value = "0.4";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(500);
  }
  const before = await readClock(page);
  const distBtn = page.getByRole("button", { name: /^Distance$/i }).first();
  await distBtn.click();
  await page.waitForTimeout(1500);
  const after = await readClock(page);
  const speedPaths = await page
    .locator('[data-apex-compare-chart] .recharts-line-curve')
    .count();
  const plotAfter = await measurePlot(page);
  const clockKept =
    before?.at != null &&
    after?.at != null &&
    after.at > 1 &&
    Math.abs(after.at - before.at) < 3;
  ok(
    "2-distance-axis-keeps-charts-and-clock",
    speedPaths >= 1 && clockKept && (plotAfter.plotH ?? 0) > 50,
    JSON.stringify({ before, after, speedPaths, plotAfter }),
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-1280-distance-axis.png"),
    fullPage: false,
  });

  // Back to Time for plot height measure consistency
  await page.getByRole("button", { name: /^Time$/i }).first().click();
  await page.waitForTimeout(500);
  await page.close();
}

// ---------- 393px: plot area ≥200 ----------
{
  const iphone = devices["iPhone 13"];
  const page = await browser.newPage({
    ...iphone,
    viewport: { width: 393, height: 852 },
  });
  await page.goto(COMPARE, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForTimeout(6000);
  // Scroll charts into view
  const chart = page.locator("[data-apex-compare-chart]").first();
  await chart.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const m = await measurePlot(page);
  ok(
    "4-plot-area-ge-200",
    (m.plotH ?? 0) >= 200,
    JSON.stringify(m),
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-393-plot-height.png"),
    fullPage: false,
  });
  await page.close();
}

// ---------- 5. Session default best lap ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/sessions/${SESSION_A}`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.waitForTimeout(5000);
  const headline = await page.evaluate(() => {
    const h2 = document.querySelector('section[aria-label^="Lap"] h2');
    const time = document.querySelector(
      'section[aria-label^="Lap"] .font-mono.text-orange-400, section[aria-label^="Lap"] p.font-mono',
    );
    const best = document.querySelector("[data-apex-session-best]");
    return {
      h2: h2?.textContent?.trim() ?? null,
      time: time?.textContent?.trim() ?? null,
      sessionBest: best?.textContent?.trim() ?? null,
      aria: document
        .querySelector('section[aria-label^="Lap"]')
        ?.getAttribute("aria-label"),
    };
  });
  const isInLap =
    /Lap\s*11/i.test(headline.h2 || "") ||
    /0:0[0-9]\./.test(headline.time || "");
  const looksFlying =
    /1:3[0-9]\./.test(headline.time || "") ||
    /1:2[5-9]\./.test(headline.time || "");
  ok(
    "5-default-best-valid-lap",
    !isInLap && (looksFlying || Boolean(headline.sessionBest)),
    JSON.stringify(headline),
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-session-default-lap.png"),
    fullPage: false,
  });
  await page.close();
}

// ---------- 6. Direct track load ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/tracks/custom-thunderhill-west`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(3000);
  const body = await page.locator("main").innerText();
  const notFound = /Track not found/i.test(body);
  const hasWest = /Thunderhill|West/i.test(body);
  ok("6-direct-track-load", !notFound && hasWest, body.slice(0, 240).replace(/\s+/g, " "));
  await page.screenshot({
    path: resolve(OUT, "reqa-direct-track-load.png"),
    fullPage: false,
  });
  await page.close();
}

// ---------- 7. Leaderboard short lap ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/tracks/custom-thunderhill-west`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(2000);
  const lb = page.getByRole("tab", { name: /Leaderboard/i }).or(
    page.getByRole("button", { name: /Leaderboard/i }),
  );
  if (await lb.count()) {
    await lb.first().click();
    await page.waitForTimeout(3000);
  }
  const text = await page.locator("main").innerText();
  const hasRyan121 = /Ryan[\s\S]{0,80}1:21\.908/i.test(text);
  const topTimes = [...text.matchAll(/\b1:\d{2}\.\d{3}\b/g)].map((m) => m[0]).slice(0, 8);
  ok(
    "7-short-lap-excluded",
    !hasRyan121,
    JSON.stringify({ hasRyan121, topTimes: topTimes.slice(0, 5), snippet: text.slice(0, 400).replace(/\s+/g, " ") }),
  );
  await page.screenshot({
    path: resolve(OUT, "reqa-leaderboard-short-lap.png"),
    fullPage: false,
  });
  await page.close();
}

await browser.close();

const allPass = Object.values(results.checks).every((c) => c.pass);
results.ok = allPass;
writeFileSync(resolve(OUT, "reqa-remaining-proof.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ ok: allPass, file: `${OUT}/reqa-remaining-proof.json` }));
process.exit(allPass ? 0 : 1);
