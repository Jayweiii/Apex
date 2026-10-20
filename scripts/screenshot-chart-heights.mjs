/**
 * Seed Spreewaldring (2+ real laps) and assert every chart plot ≥ 100px
 * at 1440x900, 1280x720, and iPhone. Screenshots under /opt/cursor/artifacts.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const dataset = JSON.parse(
  fs.readFileSync(
    path.join(root, "public/datasets/spreewaldring-stc.json"),
    "utf8",
  ),
);

const sessionId = "local-chart-height-demo";
const stored = {
  id: sessionId,
  name: dataset.name,
  filename: dataset.filename ?? null,
  created_at: dataset.created_at ?? new Date().toISOString(),
  trackId: dataset.trackId,
  car: dataset.car,
  kind: dataset.kind,
  attribution: dataset.attribution,
  sourceKind: "csv",
  laps: dataset.laps.map((lap, index) => ({
    id: `${sessionId}-lap-${lap.lapNumber}`,
    lap_number: lap.lapNumber,
    lap_time_ms: lap.lapTimeMs,
    start_offset_sec: index === 0 ? 0 : undefined,
    telemetry: lap.points,
  })),
  videos: [],
};

if (stored.laps.length < 2) {
  throw new Error(`need 2+ laps, got ${stored.laps.length}`);
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

async function seed(page) {
  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    localStorage.setItem("apex.local-sessions", JSON.stringify([payload]));
  }, stored);
}

async function prepareForCharts(page, kind) {
  const close = page.locator('button:has-text("Close")').first();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await page.waitForTimeout(300);
  }
  await page.evaluate((mode) => {
    if (mode === "compare") {
      const label = Array.from(document.querySelectorAll("p")).find((p) =>
        /telemetry/i.test(p.textContent ?? ""),
      );
      label?.scrollIntoView({ block: "start" });
    } else {
      document
        .querySelector('[data-apex-chart-plot="speed"]')
        ?.scrollIntoView({ block: "nearest" });
      document
        .querySelector("[data-apex-g-chart]")
        ?.scrollIntoView({ block: "nearest" });
    }
  }, kind);
  await page.waitForTimeout(800);
}

async function measureCharts(page) {
  return page.evaluate(() => {
    const picks = [...document.querySelectorAll("[data-apex-chart-plot]")];
    const seen = new Set();
    const rows = [];
    for (const el of picks) {
      if (seen.has(el)) continue;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      rows.push({
        plot: el.getAttribute("data-apex-chart-plot") ?? "unknown",
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      });
    }
    return rows;
  });
}

async function capture(page, url, file, size, kind) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(1500);
  await prepareForCharts(page, kind);
  await page.waitForSelector("[data-apex-chart-plot]", { timeout: 20000 });
  await page.waitForTimeout(500);
  const charts = await measureCharts(page);
  const dest = path.join(outDir, file);
  await page.screenshot({ path: dest, fullPage: false });

  const tooSmall = charts.filter((c) => c.height < 100 && c.width > 40);
  const report = { file, size, chartCount: charts.length, charts, tooSmall, path: dest };
  console.log(JSON.stringify(report));
  if (!charts.length) throw new Error(`${file}: no chart plots found`);
  if (tooSmall.length) {
    throw new Error(
      `${file}: charts <100px: ${tooSmall.map((c) => `${c.plot}=${c.height}`).join(", ")}`,
    );
  }
  return report;
}

const context = await browser.newContext();
const page = await context.newPage();
await seed(page);

const sizes = [
  { width: 1440, height: 900, tag: "1440x900" },
  { width: 1280, height: 720, tag: "1280x720" },
  { width: 390, height: 844, tag: "iphone" },
];

for (const size of sizes) {
  await capture(
    page,
    `http://localhost:3000/sessions/${sessionId}?lap=2`,
    `session-charts-${size.tag}.png`,
    size,
    "session",
  );
  await capture(
    page,
    `http://localhost:3000/sessions/${sessionId}/compare`,
    `compare-charts-${size.tag}.png`,
    size,
    "compare",
  );
}

await browser.close();
console.log(JSON.stringify({ ok: true, laps: stored.laps.length }));
