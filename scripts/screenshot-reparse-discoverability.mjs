/**
 * Seed a local unsplit session (1 lap ~20 min) and capture owner UI:
 * lap-list "Re-parse laps" + unsplit banner on phone width.
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

const first = dataset.laps[0];
const sessionId = "local-reparse-unsplit-demo";
const longLapMs = 20 * 60 * 1000 + 2962; // mirrors Jason's ~20 min blob
const stored = {
  id: sessionId,
  name: "Thunderhill West · unsplit (re-parse demo)",
  filename: dataset.filename ?? null,
  created_at: new Date().toISOString(),
  trackId: dataset.trackId ?? "thunderhill-west",
  car: dataset.car ?? "Demo",
  kind: "upload",
  attribution: dataset.attribution,
  sourceKind: "gopro",
  laps: [
    {
      id: `${sessionId}-lap-1`,
      lap_number: 1,
      lap_time_ms: longLapMs,
      start_offset_sec: 0,
      // Keep a short telemetry strip so the session page still renders.
      telemetry: (first?.points ?? []).slice(0, 80).map((p, i) => ({
        ...p,
        t: i * 0.2,
      })),
    },
  ],
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

async function capture(page, url, file, size, after) {
  await page.setViewportSize(size);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  if (after) await after(page);
  const dest = path.join(outDir, file);
  await page.screenshot({ path: dest, fullPage: false });
  const hasBtn = await page.getByRole("button", { name: /Re-parse laps/i }).count();
  const hasBanner = await page
    .getByText(/Looks like laps weren't split/i)
    .count();
  console.log(JSON.stringify({ file, size, hasBtn, hasBanner, path: dest }));
}

const context = await browser.newContext();
const page = await context.newPage();
await seed(page);

await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=1`,
  "reparse-discoverability-desktop.png",
  { width: 1280, height: 800 },
);

await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=1`,
  "reparse-discoverability-iphone.png",
  { width: 390, height: 844 },
);

await capture(
  page,
  `http://localhost:3000/sessions/${sessionId}?lap=1`,
  "reparse-discoverability-iphone-panel.png",
  { width: 390, height: 844 },
  async (p) => {
    const banner = p.getByRole("button", { name: /Re-parse laps/i }).first();
    await banner.click();
    await p.waitForTimeout(800);
  },
);

await browser.close();
