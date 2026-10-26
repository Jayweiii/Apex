/**
 * Playwright smoke for live-QA fixes against a deployed URL (or local).
 * Usage: BASE_URL=https://apex-ashy-beta.vercel.app node scripts/qa-live-fixes.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = resolve("/opt/cursor/artifacts");
mkdirSync(OUT, { recursive: true });

const results = {
  base: BASE,
  at: new Date().toISOString(),
  checks: {},
};

function ok(name, pass, detail) {
  results.checks[name] = { pass: Boolean(pass), detail: detail ?? null };
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });

// --- Desktop: track page sessions + map outline ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/tracks/thunderhill-west`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  const body = await page.locator("body").innerText();
  const hasPublic =
    /public sessions/i.test(body) ||
    /Session 2|Thunderhill West Session|Log 20261017/i.test(body);
  const emptyLeaderboard =
    /No sessions yet/i.test(body) && /Leaderboard/i.test(body);
  // Ensure Sessions tab (map + public list), then Leaderboard
  const sessionsTab = page.getByRole("tab", { name: /^Sessions$/i });
  if (await sessionsTab.count()) {
    await sessionsTab.click();
    await page.waitForTimeout(1500);
  }
  const mapEl = page.locator(".leaflet-container, .maplibregl-map, .leaflet-tile-pane").first();
  ok("track-map-present", (await mapEl.count()) > 0, "leaflet/maplibre present");
  await page.screenshot({
    path: resolve(OUT, "qa-track-thunderhill-west.png"),
    fullPage: true,
  });
  const lb = page.getByRole("tab", { name: /Leaderboard/i });
  if (await lb.count()) {
    await lb.click();
    await page.waitForTimeout(1500);
  }
  const afterLb = await page.locator("body").innerText();
  const lbEmpty = /No sessions yet/i.test(afterLb);
  ok(
    "track-sessions",
    hasPublic || !lbEmpty,
    hasPublic
      ? "public sessions visible"
      : !lbEmpty
        ? "leaderboard has rows"
        : "still empty",
  );
  await page.screenshot({
    path: resolve(OUT, "qa-track-leaderboard.png"),
    fullPage: true,
  });
  await page.close();
}

// --- iPhone header + compare chart height ---
{
  const iphone = devices["iPhone 12"];
  const context = await browser.newContext({
    ...iphone,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1000);
  const header = page.locator("header").first();
  await header.screenshot({ path: resolve(OUT, "qa-mobile-header-home.png") });
  const menuBtn = page.getByRole("button", { name: /Open menu|Close menu/i });
  ok("mobile-menu-btn", (await menuBtn.count()) > 0, "compact menu control");
  // Top bar only (menu closed): visible chrome is APEX + hamburger (w>0).
  // Hidden desktop controls still appear in textContent — check layout boxes.
  const topRow = await page
    .locator("header")
    .first()
    .evaluate((el) => {
      const row = el.firstElementChild;
      if (!row) return null;
      const visible = [...row.querySelectorAll("a,button")].filter(
        (node) => node.getBoundingClientRect().width > 1,
      );
      const labels = visible.map((node) =>
        (node.getAttribute("aria-label") || node.textContent || "")
          .trim()
          .toLowerCase(),
      );
      return {
        h: Math.round(row.getBoundingClientRect().height),
        labels,
        hasMph: labels.some((t) => /mph|km\/h/.test(t)),
        hasAuth: labels.some((t) =>
          /sign out|sign in|my sessions|keep sessions/.test(t),
        ),
      };
    })
    .catch(() => null);
  ok(
    "mobile-header-compact",
    topRow != null && topRow.h < 80 && !topRow.hasMph && !topRow.hasAuth,
    topRow
      ? `top h=${topRow.h} visible=[${topRow.labels.join(",")}]`
      : "no header",
  );
  if (await menuBtn.count()) {
    await menuBtn.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, "qa-mobile-header-menu.png") });
  }
  await context.close();
}

// --- Compare: play rate + gap + chart height (public session) ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Known public west session with many laps
  const sessionId = "340f914a-49f7-4c6e-bccc-33a3fe2de689";
  await page.goto(`${BASE}/sessions/${sessionId}/compare`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(4000);
  const text = await page.locator("body").innerText();
  ok(
    "compare-loaded",
    /Compare|Comparing|Lap/i.test(text) && !/Loading compare/i.test(text),
    "compare UI ready",
  );

  // Session picker labels should include lap count or time
  const options = await page.locator("select option").allTextContents();
  const disambiguated = options.some(
    (o) => /\d+\s*laps?/i.test(o) || /\d{1,2}:\d{2}/.test(o) || /AM|PM/i.test(o),
  );
  ok(
    "session-labels",
    disambiguated || options.length <= 1,
    disambiguated
      ? "labels include time/laps"
      : `options=${options.slice(0, 3).join(" | ")}`,
  );

  // Chart plot height ≥ 200
  const plot = page.locator("[data-apex-chart-plot='compare']").first();
  if (await plot.count()) {
    const box = await plot.boundingBox();
    ok(
      "compare-chart-height-desktop",
      box != null && box.height >= 195,
      box ? `h=${Math.round(box.height)}` : "missing",
    );
  } else {
    ok("compare-chart-height-desktop", false, "no compare plot");
  }

  // Play rate: advance scrubber ~1s media in ~1–1.5s wall at 1x
  const play = page.getByRole("button", { name: /^Play$/i }).first();
  const readClock = async () => {
    const group = page.locator("[role='group']").filter({ hasText: /Playback|Lap playback/i }).first();
    const text = await group.innerText().catch(() => "");
    const m = text.match(/(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/);
    return m ? Number(m[1]) : null;
  };
  if (await play.count()) {
    const a = await readClock();
    await play.click();
    await page.waitForTimeout(2000);
    const b = await readClock();
    await page.getByRole("button", { name: /^Pause$/i }).first().click().catch(() => {});
    const delta = a != null && b != null ? b - a : null;
    // After 2s wall at 1x expect ~1.2–2.8s of progress (not ~0.5s).
    ok(
      "play-rate-1x",
      delta != null && delta >= 1.0 && delta <= 3.5,
      `Δt=${delta} (before=${a} after=${b})`,
    );
  } else {
    ok("play-rate-1x", false, "no Play button");
  }

  await page.screenshot({
    path: resolve(OUT, "qa-compare-desktop.png"),
    fullPage: true,
  });
  await page.close();
}

// --- iPhone compare chart height ---
{
  const context = await browser.newContext({
    ...devices["iPhone 12"],
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const sessionId = "340f914a-49f7-4c6e-bccc-33a3fe2de689";
  await page.goto(`${BASE}/sessions/${sessionId}/compare`, {
    waitUntil: "networkidle",
    timeout: 90_000,
  });
  await page.waitForTimeout(4000);
  const plot = page.locator("[data-apex-chart-plot='compare']").first();
  if (await plot.count()) {
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    ok(
      "compare-chart-height-iphone",
      box != null && box.height >= 195,
      box ? `h=${Math.round(box.height)}` : "missing",
    );
  } else {
    ok("compare-chart-height-iphone", false, "no plot yet (prod may lag deploy)");
  }
  await page.screenshot({
    path: resolve(OUT, "qa-compare-iphone.png"),
    fullPage: true,
  });
  await context.close();
}

await browser.close();

const failed = Object.values(results.checks).filter((c) => !c.pass).length;
results.failed = failed;
writeFileSync(resolve(OUT, "qa-live-fixes.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
