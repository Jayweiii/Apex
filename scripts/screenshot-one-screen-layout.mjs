/**
 * Seed Spreewaldring local session and capture session/compare at desktop + phone.
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

const sessionId = "local-one-screen-demo";
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

async function capture(page, url, file, size) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  const scroll = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScroll: document.body.scrollHeight,
  }));
  const dest = path.join(outDir, file);
  await page.screenshot({ path: dest, fullPage: false });
  console.log(JSON.stringify({ file, size, scroll, path: dest }));
}

const context = await browser.newContext();
const page = await context.newPage();
await seed(page);

await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=2`,
  "session-one-screen-1440x900.png",
  { width: 1440, height: 900 },
);
await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=2`,
  "session-one-screen-1280x720.png",
  { width: 1280, height: 720 },
);
await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=2`,
  "session-one-screen-iphone.png",
  { width: 390, height: 844 },
);
await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}/compare`,
  "compare-one-screen-1440x900.png",
  { width: 1440, height: 900 },
);

await browser.close();
