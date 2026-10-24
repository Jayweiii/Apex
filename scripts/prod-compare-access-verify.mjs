/**
 * Prod verify: public comparisons open with charts (anon).
 * Usage: node scripts/prod-compare-access-verify.mjs [label]
 */
import { chromium } from "playwright";
import fs from "node:fs";

const label = process.argv[2] || "verify";
const base = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const ids = [
  "f9978e51-e363-4b67-998e-b7682b1a272a",
  "b3d74813-1ad5-4786-a47a-887cc049b60e",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const results = [];

for (const id of ids) {
  const url = `${base}/compare/${id}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(4000);

  // Wait for chart or failure text
  try {
    await page.waitForSelector(
      '[data-apex-chart-plot="speed"], .recharts-wrapper, text=Not enough accessible',
      { timeout: 15000 },
    );
  } catch {
    /* continue to measure */
  }

  const shot = `${outDir}/compare-access-${label}-${id.slice(0, 8)}.png`;
  await page.screenshot({ path: shot, fullPage: true });

  const info = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    const speed =
      document.querySelector('[data-apex-chart-plot="speed"]') ||
      document.querySelector(".recharts-wrapper");
    const map =
      document.querySelector('[data-apex-map="chase"]') ||
      document.querySelector('[data-apex-map="fixed-scrub"]') ||
      document.querySelector(".maplibregl-map") ||
      document.querySelector(".leaflet-container");
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const paths = speed
      ? [...speed.querySelectorAll("path")].filter((p) => (p.getAttribute("d") || "").length > 40)
      : [];
    return {
      title: document.title,
      hasNoAccess: /not enough accessible|are not accessible|could not be matched/i.test(body),
      hasPublic: /public/i.test(body),
      hasUntitled: /untitled comparison/i.test(body),
      speedBox: box(speed),
      mapBox: box(map),
      speedPaths: paths.length,
      snippet: body.slice(0, 400),
    };
  });

  const ok =
    !info.hasNoAccess &&
    info.speedBox &&
    info.speedBox.h >= 80 &&
    info.speedPaths >= 1;

  results.push({ id, url, shot, ok, ...info });
  console.log(JSON.stringify(results[results.length - 1], null, 2));
}

await browser.close();

const allOk = results.every((r) => r.ok);
fs.writeFileSync(
  `${outDir}/compare-access-${label}.json`,
  JSON.stringify({ allOk, results }, null, 2),
);
console.log(allOk ? "PASS" : "FAIL");
process.exit(allOk ? 0 : 1);
