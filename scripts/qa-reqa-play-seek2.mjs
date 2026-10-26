import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "https://apex-ashy-beta.vercel.app";
const SESSION_B = "1aa2fb88-8204-4abb-b745-520ea99819dd";
const COMPARE = `${BASE}/sessions/${SESSION_B}/compare`;

async function clock(page) {
  return page.evaluate(() => {
    const toggle = document.querySelector("[data-apex-play-toggle]");
    const group = toggle?.closest("[role=group]");
    const spans = [...(group?.querySelectorAll("span.font-mono, .font-mono") || [])];
    const clockSpan = spans.find((s) => /\d+(?:\.\d+)?s\s*\/\s*\d/.test(s.textContent || ""));
    const text = clockSpan?.textContent?.trim() || group?.innerText?.match(/\d+(?:\.\d+)?s\s*\/\s*\d+(?:\.\d+)?s/)?.[0] || null;
    const m = (text || "").match(/(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/);
    const range = document.querySelector('input[type=range]');
    return {
      text,
      at: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      range: range ? Number(range.value) : null,
      play: toggle?.getAttribute("aria-label"),
      groupSnippet: (group?.innerText || "").replace(/\s+/g, " ").slice(0, 200),
    };
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(COMPARE, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(8000);

const c0 = await clock(page);
console.log("c0", c0);

// Scrub via React-friendly setter
const scrub = page.locator('input[type=range]').first();
await scrub.evaluate((el) => {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, "450");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(700);
const cScrub = await clock(page);
console.log("cScrub", cScrub);

// Native Playwright
await scrub.focus();
await page.keyboard.press("End");
await page.waitForTimeout(400);
const cEnd = await clock(page);
console.log("cEnd", cEnd);

await scrub.evaluate((el) => {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, "200");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(500);
const c200 = await clock(page);
console.log("c200", c200);

// Chart click seek
const plot = page.locator('[data-apex-chart-plot="compare"]').first();
await plot.scrollIntoViewIfNeeded();
const box = await plot.boundingBox();
await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.45);
await page.waitForTimeout(700);
const cClick = await clock(page);
console.log("cClick", cClick);

// Play 3s
await page.locator("[data-apex-play-toggle]").first().click();
await page.waitForTimeout(3000);
const cPlay = await clock(page);
console.log("cPlay", cPlay);
await page.locator("[data-apex-play-toggle]").first().click();
await page.waitForTimeout(400);
const cPause = await clock(page);
console.log("cPause", cPause);

// Distance toggle
await page.getByRole("button", { name: /^Distance$/i }).click();
await page.waitForTimeout(1000);
const cDist = await clock(page);
console.log("cDist", cDist);
await page.getByRole("button", { name: /^Time$/i }).click();
await page.waitForTimeout(800);
const cTime = await clock(page);
console.log("cTime", cTime);

const out = { c0, cScrub, cEnd, c200, cClick, cPlay, cPause, cDist, cTime };
writeFileSync("/opt/cursor/artifacts/reqa2-play-detail.json", JSON.stringify(out, null, 2));
await page.screenshot({ path: "/opt/cursor and artifacts".replace(" and ", "/") + "reqa2-play-detail.png" });
await browser.close();
console.log(JSON.stringify(out, null, 2));
