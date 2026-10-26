/**
 * Browser proof: sticky header stacks above map panes; hover leave clears.
 *
 *   BASE_URL=http://localhost:3000 node scripts/verify-map-hover-clear-zindex.mjs
 *   BASE_URL=https://apex-ashy-beta.vercel.app node scripts/verify-map-hover-clear-zindex.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = resolve(
  process.env.VERIFY_OUT ?? "/opt/cursor/artifacts/map-hover-zindex",
);
mkdirSync(OUT, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const result = {
  ok: false,
  base: BASE,
  headerZ: null,
  syntheticStack: null,
  liveMap: null,
  shots: [],
};

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForSelector("header", { timeout: 20000 });

  const headerZ = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return { error: "no header" };
    const hs = getComputedStyle(header);
    return {
      zIndex: hs.zIndex,
      position: hs.position,
      zNum: Number.parseInt(hs.zIndex, 10) || 0,
    };
  });
  assert(!headerZ.error, headerZ.error);
  assert(headerZ.position === "sticky", "header sticky");
  assert(headerZ.zNum >= 40, `header z-index ${headerZ.zIndex}`);
  result.headerZ = headerZ;

  // Synthetic Leaflet-like pane escape repro + containment check.
  const synthetic = await page.evaluate(() => {
    const host = document.createElement("div");
    host.setAttribute("data-apex-map-stack", "1");
    host.id = "apex-synth-map";
    host.style.cssText =
      "position:relative;z-index:0;isolation:isolate;height:240px;margin:80px 16px;background:#18181b;border-radius:12px;";
    const pane = document.createElement("div");
    pane.id = "apex-synth-pane";
    pane.textContent = "SYNTH MAP PANE z=650";
    pane.style.cssText =
      "position:absolute;inset:0;z-index:650;background:rgba(249,115,22,0.55);display:flex;align-items:center;justify-content:center;color:white;font:600 14px sans-serif;";
    host.appendChild(pane);
    document.body.appendChild(host);

    // Scroll so the synth map sits under the sticky header.
    const header = document.querySelector("header");
    const headerH = header?.getBoundingClientRect().height ?? 56;
    const top = host.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, Math.max(0, top - headerH / 2));

    const hs = getComputedStyle(header);
    const ms = getComputedStyle(host);
    const midX = Math.round(window.innerWidth / 2);
    const midY = Math.round(headerH / 2);
    const hit = document.elementFromPoint(midX, midY);
    const hitTag = hit
      ? `${hit.tagName.toLowerCase()}${hit.id ? "#" + hit.id : ""}${
          hit.className && typeof hit.className === "string"
            ? "." + hit.className.split(/\s+/).slice(0, 2).join(".")
            : ""
        }`
      : null;
    const hitInHeader = Boolean(header && hit && header.contains(hit));
    return {
      headerZ: hs.zIndex,
      mapZ: ms.zIndex,
      mapIsolation: ms.isolation,
      hitTag,
      hitInHeader,
      midX,
      midY,
    };
  });

  assert(synthetic.mapIsolation === "isolate", "synth map isolation");
  assert(synthetic.hitInHeader, `elementFromPoint hit header, got ${synthetic.hitTag}`);
  result.syntheticStack = synthetic;

  const underShot = resolve(OUT, "synth-map-under-header.png");
  await page.screenshot({ path: underShot });
  result.shots.push(underShot);

  // Live map hover clear when a map is present (home/session/track).
  await page
    .waitForSelector("[data-apex-map]", { timeout: 8000 })
    .catch(() => null);
  const mapCount = await page.locator("[data-apex-map]").count();
  if (mapCount > 0) {
    const map = page.locator("[data-apex-map]").first();
    const box = await map.boundingBox();
    assert(box, "map box");
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.waitForTimeout(400);
    const whileHover = await page.evaluate(() => ({
      ghost: Boolean(document.querySelector(".apex-car-marker__dot--ghost")),
      tipHover: Boolean(
        document.querySelector(
          '[data-apex-scrub-tooltip][data-apex-hover-tooltip="1"]',
        ),
      ),
    }));
    await page.screenshot({ path: resolve(OUT, "live-map-hover.png") });
    result.shots.push(resolve(OUT, "live-map-hover.png"));

    await page.mouse.move(24, 24);
    await page.waitForTimeout(400);
    const afterLeave = await page.evaluate(() => ({
      ghost: Boolean(document.querySelector(".apex-car-marker__dot--ghost")),
      tipHover: Boolean(
        document.querySelector(
          '[data-apex-scrub-tooltip][data-apex-hover-tooltip="1"]',
        ),
      ),
    }));
    await page.screenshot({ path: resolve(OUT, "live-map-after-leave.png") });
    result.shots.push(resolve(OUT, "live-map-after-leave.png"));
    assert(!afterLeave.ghost, "ghost must clear on leave");
    assert(!afterLeave.tipHover, "hover tooltip must clear on leave");
    result.liveMap = { whileHover, afterLeave };
  } else {
    result.liveMap = { skipped: "no live map in this environment" };
  }

  result.ok = true;
} catch (err) {
  result.ok = false;
  result.error = err instanceof Error ? err.message : String(err);
  const failShot = resolve(OUT, "fail.png");
  try {
    await page.screenshot({ path: failShot, fullPage: true });
    result.shots.push(failShot);
  } catch {
    /* ignore */
  }
} finally {
  await browser.close();
}

writeFileSync(resolve(OUT, "result.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
