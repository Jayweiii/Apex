import fs from "node:fs";
import puppeteer from "puppeteer-core";

const base = process.argv[2] || "http://127.0.0.1:3010";
const url = `${base}/sessions/pub-spreewaldring-stc/laps/pub-spreewaldring-stc-lap-2`;
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--window-size=1400,1100"],
  defaultViewport: { width: 1400, height: 1100 },
});
const page = await browser.newPage();
await page.goto(url, { waitUntil: "networkidle2" });
await page.waitForSelector("[data-apex-map='fixed-scrub']", { timeout: 45000 });
await page.waitForSelector(".recharts-wrapper", { timeout: 30000 });

const chart = await page.evaluate(() => {
  const wrap = document.querySelector(".recharts-wrapper");
  const r = wrap.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
console.log("chart", chart);

await page.mouse.move(chart.x + chart.w * 0.4, chart.y + chart.h * 0.5);
await new Promise(r => setTimeout(r, 400));

let info = await page.evaluate(() => ({
  dots: document.querySelectorAll(".apex-car-marker__dot").length,
  markers: document.querySelectorAll(".leaflet-marker-icon").length,
  tooltip: !!document.querySelector("[data-apex-scrub-tooltip]"),
  activeLines: document.querySelectorAll(".recharts-tooltip-cursor, .recharts-active-dot").length,
}));
console.log("after chart hover", info);

// Force Leaflet map mouse event at center
info = await page.evaluate(() => {
  const el = document.querySelector("[data-apex-map='fixed-scrub']");
  const r = el.getBoundingClientRect();
  const x = r.left + r.width * 0.5;
  const y = r.top + r.height * 0.5;
  el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y, view: window }));
  return {
    afterDispatchDots: document.querySelectorAll(".apex-car-marker__dot").length,
    leafletMarkers: document.querySelectorAll(".leaflet-marker-icon").length,
    tooltip: !!document.querySelector("[data-apex-scrub-tooltip]"),
  };
});
console.log("after map dispatch", info);

// Use puppeteer mouse on map
const map = await page.evaluate(() => {
  const el = document.querySelector("[data-apex-map='fixed-scrub']");
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
await page.mouse.move(map.x + map.w * 0.48, map.y + map.h * 0.52);
await new Promise(r => setTimeout(r, 400));
info = await page.evaluate(() => ({
  dots: document.querySelectorAll(".apex-car-marker__dot").length,
  leafletMarkers: document.querySelectorAll(".leaflet-marker-icon").length,
  tooltip: !!document.querySelector("[data-apex-scrub-tooltip]"),
  panes: [...document.querySelectorAll(".leaflet-pane")].map(p => p.className),
  markerHtml: document.querySelector(".leaflet-marker-pane")?.innerHTML?.slice(0, 300) || null,
}));
console.log("after map mouse", info);
await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/map-debug-hover.png", fullPage: false });
await browser.close();
