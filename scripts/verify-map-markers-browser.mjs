/**
 * Headless Chrome: open a real GPS session, scrub the Speed chart, assert
 * .apex-car-marker__dot is visible, save screenshots.
 *
 * Usage: node scripts/verify-map-markers-browser.mjs [baseUrl]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const base = (process.argv[2] || "http://127.0.0.1:3010").replace(/\/$/, "");
const outDir = "/opt/cursor/artifacts/screenshots";
fs.mkdirSync(outDir, { recursive: true });

const lapPath =
  "/sessions/pub-spreewaldring-stc/laps/pub-spreewaldring-stc-lap-2";
const url = `${base}${lapPath}`;

const chromePaths = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/local/bin/google-chrome",
].filter(Boolean);

async function main() {
  const executablePath = chromePaths.find((p) => fs.existsSync(p));
  if (!executablePath) throw new Error("Chrome not found");

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1400,1100",
    ],
    defaultViewport: { width: 1400, height: 1100 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(url, { waitUntil: "networkidle2" });
  await page.waitForSelector("[data-apex-map='fixed-scrub']", { timeout: 45000 });
  await page.waitForSelector(".recharts-wrapper", { timeout: 45000 });
  await page.waitForFunction(() => {
    const map = document.querySelector(".leaflet-container");
    return map && map.clientHeight >= 280;
  });

  const beforePath = path.join(outDir, "map-scrub-before-hover.png");
  await page.screenshot({ path: beforePath, fullPage: false });

  // --- Chart hover scrub (scroll chart into view first) ---
  await page.evaluate(() => {
    document.querySelector(".recharts-wrapper")?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
  });
  await new Promise((r) => setTimeout(r, 200));

  const chartBox = await page.evaluate(() => {
    const wrap = document.querySelector(".recharts-wrapper");
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (!chartBox || chartBox.w < 40) {
    throw new Error(`Speed chart not found: ${JSON.stringify(chartBox)}`);
  }

  for (let i = 1; i <= 10; i += 1) {
    const x = chartBox.x + (chartBox.w * i) / 11;
    const y = chartBox.y + chartBox.h * 0.55;
    await page.mouse.move(x, y);
    await new Promise((r) => setTimeout(r, 80));
  }
  // Stay over chart — do not mouseleave.
  await page.mouse.move(chartBox.x + chartBox.w * 0.55, chartBox.y + chartBox.h * 0.55);
  await new Promise((r) => setTimeout(r, 300));

  const chartHoverInfo = await page.evaluate(() => {
    const dots = [...document.querySelectorAll(".apex-car-marker__dot")];
    const first = dots[0]?.getBoundingClientRect();
    return {
      dotCount: dots.length,
      markerCount: document.querySelectorAll(".apex-car-marker").length,
      tooltip: Boolean(document.querySelector("[data-apex-scrub-tooltip]")),
      firstDot: first
        ? { w: first.width, h: first.height, top: first.top, left: first.left }
        : null,
      compact: first ? first.width <= 14 && first.height <= 14 : false,
    };
  });

  const afterPath = path.join(outDir, "map-scrub-chart-hover-markers.png");
  // Full page so map + charts both show the marker while chart is hovered.
  await page.screenshot({ path: afterPath, fullPage: true });

  // --- Map hover scrub ---
  await page.evaluate(() => {
    document.querySelector("[data-apex-map='fixed-scrub']")?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
  });
  await new Promise((r) => setTimeout(r, 200));

  const mapBox = await page.evaluate(() => {
    const el = document.querySelector("[data-apex-map='fixed-scrub']");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  if (!mapBox) throw new Error("map not found");

  await page.mouse.move(mapBox.x + mapBox.w * 0.42, mapBox.y + mapBox.h * 0.48);
  await new Promise((r) => setTimeout(r, 150));
  await page.mouse.move(mapBox.x + mapBox.w * 0.58, mapBox.y + mapBox.h * 0.55);
  await new Promise((r) => setTimeout(r, 300));

  const mapHoverInfo = await page.evaluate(() => {
    const dots = [...document.querySelectorAll(".apex-car-marker__dot")];
    const mapEl = document.querySelector("[data-apex-map='fixed-scrub']");
    const first = dots[0]?.getBoundingClientRect();
    return {
      dotCount: dots.length,
      mapHeight: mapEl?.clientHeight ?? 0,
      hasZoomControl: Boolean(document.querySelector(".leaflet-control-zoom")),
      tooltip: Boolean(document.querySelector("[data-apex-scrub-tooltip]")),
      firstDot: first
        ? { w: first.width, h: first.height, top: first.top, left: first.left }
        : null,
    };
  });

  const mapScrubPath = path.join(outDir, "map-scrub-map-hover-markers.png");
  await page.screenshot({ path: mapScrubPath, fullPage: false });

  await browser.close();

  const ok =
    chartHoverInfo.dotCount >= 1 &&
    chartHoverInfo.firstDot &&
    chartHoverInfo.firstDot.w >= 6 &&
    chartHoverInfo.firstDot.w <= 14 &&
    chartHoverInfo.compact === true &&
    mapHoverInfo.dotCount >= 1 &&
    mapHoverInfo.mapHeight >= 280 &&
    mapHoverInfo.hasZoomControl === false;

  console.log(
    JSON.stringify(
      {
        ok,
        url,
        chartHoverInfo,
        mapHoverInfo,
        errors,
        screenshots: [beforePath, afterPath, mapScrubPath],
      },
      null,
      2,
    ),
  );

  if (!ok) {
    process.exitCode = 1;
    throw new Error(
      `Marker verification failed: ${JSON.stringify({ chartHoverInfo, mapHoverInfo })}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
