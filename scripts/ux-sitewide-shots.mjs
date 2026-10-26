/**
 * Sitewide UX before/after screenshots @ desktop 1280 and iPhone 390.
 * Usage: PHASE=before|after node scripts/ux-sitewide-shots.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const phase = process.env.PHASE || "before";
const baseUrl = process.env.APEX_BASE_URL || process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const sessionId = process.env.APEX_SESSION_ID || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const outName = `ux-${phase}`;
const outDirs = [
  "/opt/cursor/artifacts",
  path.join(process.cwd(), "artifacts", outName),
];
for (const d of outDirs) fs.mkdirSync(d, { recursive: true });

const pages = [
  { id: "home", path: "/" },
  { id: "login", path: "/login" },
  { id: "upload", path: "/upload" },
  { id: "account", path: "/account" },
  { id: "tracks", path: "/tracks" },
  { id: "lap-comparisons", path: "/lap-comparisons" },
  { id: "session", path: `/sessions/${sessionId}` },
  { id: "compare", path: `/sessions/${sessionId}/compare` },
  { id: "share", path: `/share/${sessionId}` },
];

const viewports = [
  { name: "d1280", width: 1280, height: 800, device: null },
  { name: "i390", width: 390, height: 844, device: devices["iPhone 12"] },
];

async function shot(page, name) {
  const file = `${outName}-${name}.png`;
  const primary = path.join(outDirs[0], file);
  await page.screenshot({ path: primary, fullPage: false });
  for (const d of outDirs.slice(1)) fs.copyFileSync(primary, path.join(d, file));
  console.log("wrote", primary);
}

async function audit(page) {
  return page.evaluate(() => {
    const issues = [];
    const docW = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    if (scrollW > docW + 2) issues.push(`h-overflow:${scrollW - docW}px`);
    const nested = [...document.querySelectorAll("*")]
      .filter((el) => {
        const s = getComputedStyle(el);
        const oy = s.overflowY;
        if (oy !== "auto" && oy !== "scroll") return false;
        const r = el.getBoundingClientRect();
        return (
          r.height > 80 &&
          r.height < window.innerHeight * 0.95 &&
          el.scrollHeight > el.clientHeight + 20
        );
      })
      .slice(0, 6)
      .map(
        (el) =>
          `${el.tagName}.${String(el.className || "").slice(0, 50)} h=${Math.round(el.getBoundingClientRect().height)}`,
      );
    if (nested.length) issues.push(`nested-scroll:${nested.join("|")}`);
    const tinyMaps = [...document.querySelectorAll(".leaflet-container,[data-apex-map]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width) };
      })
      .filter((m) => m.h > 0 && m.h < 160);
    if (tinyMaps.length) issues.push(`tiny-map:${JSON.stringify(tinyMaps)}`);
    return {
      title: document.title,
      issues,
      h1: document.querySelector("h1")?.textContent?.trim()?.slice(0, 80) || null,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const report = [];
for (const vp of viewports) {
  const context = await browser.newContext(
    vp.device
      ? { ...devices["iPhone 12"], viewport: { width: vp.width, height: vp.height } }
      : { viewport: { width: vp.width, height: vp.height } },
  );
  const page = await context.newPage();
  for (const p of pages) {
    const url = baseUrl + p.path;
    try {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2800);
      const a = await audit(page);
      await shot(page, `${p.id}-${vp.name}`);
      report.push({ page: p.id, vp: vp.name, status: res?.status(), ...a });
      console.log(JSON.stringify(report.at(-1)));
    } catch (e) {
      report.push({ page: p.id, vp: vp.name, error: String(e) });
      console.error(p.id, vp.name, e);
    }
  }
  await context.close();
}
await browser.close();
const reportPath = path.join(outDirs[0], `${outName}-audit.json`);
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDirs[1], "audit.json"), JSON.stringify(report, null, 2));
console.log("DONE", report.length, reportPath);
