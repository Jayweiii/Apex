/**
 * Production Playwright: while playing, hover preview is off on chart + map;
 * when paused, hover returns; click-while-playing still seeks.
 *
 * Usage:
 *   node scripts/prod-hover-while-playing-verify.mjs [sessionId]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = process.env.APEX_ARTIFACT_DIR || "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hoverOpacity(page) {
  return page.evaluate(() => {
    const lines = [...document.querySelectorAll("[data-apex-hover-line]")];
    const opacities = lines.map((el) => {
      const style = getComputedStyle(el);
      return Number.parseFloat(style.opacity || "0");
    });
    const max = opacities.length ? Math.max(...opacities) : 0;
    const scope = document.querySelector("[data-apex-hover-scope]");
    const map = document.querySelector("[data-apex-map-hover]");
    const ghosts = document.querySelectorAll(
      ".apex-car-marker__dot--ghost, [data-apex-ghost-marker]",
    ).length;
    return {
      maxHoverOpacity: max,
      hoverEnabled: scope?.getAttribute("data-apex-hover-enabled") ?? null,
      mapHover: map?.getAttribute("data-apex-map-hover") ?? null,
      ghostCount: ghosts,
      lineCount: lines.length,
    };
  });
}

async function playbackProgress(page) {
  return page.evaluate(() => {
    const scrub = document.querySelector(
      'input[type="range"][class*="accent-orange"]',
    );
    if (!scrub) return null;
    return Number(scrub.value) / 1000;
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  const url = `${baseUrl}/sessions/${sessionId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForTimeout(3500);

  // Prefer a hot lap with charts (lap 2 often).
  for (const loc of [
    page.getByRole("button", { name: /^0?2\b/ }),
    page.locator("button").filter({ hasText: /^0?2$/ }),
  ]) {
    if ((await loc.count()) > 0) {
      try {
        await loc.first().click({ timeout: 2000 });
        await page.waitForTimeout(2000);
        break;
      } catch {
        /* continue */
      }
    }
  }

  await page.waitForSelector("[data-apex-hover-scope]", { timeout: 30_000 });
  await page.waitForSelector('[data-apex-chart-plot="speed"]', {
    timeout: 30_000,
  });

  const playBtn = page.getByRole("button", { name: /^(Play|Pause)$/ });
  assert((await playBtn.count()) > 0, "play/pause control present");

  // Ensure paused first — hover preview should work.
  if ((await playBtn.first().getAttribute("aria-label")) === "Pause") {
    await playBtn.first().click();
    await page.waitForTimeout(400);
  }

  const speedPlot = page.locator('[data-apex-chart-plot="speed"]');
  const box = await speedPlot.boundingBox();
  assert(box, "speed chart box");

  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
  await page.waitForTimeout(200);
  const pausedHover = await hoverOpacity(page);
  assert(pausedHover.hoverEnabled === "1", "paused: hover scope enabled");
  assert(
    pausedHover.maxHoverOpacity > 0.5,
    `paused: hover line visible (opacity=${pausedHover.maxHoverOpacity})`,
  );

  // Start play — hover must clear / stay off.
  await playBtn.first().click();
  await page.waitForTimeout(500);
  assert(
    (await playBtn.first().getAttribute("aria-label")) === "Pause",
    "playing after click",
  );

  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5);
  await page.waitForTimeout(250);
  const playingHover = await hoverOpacity(page);
  assert(playingHover.hoverEnabled === "0", "playing: hover scope disabled");
  assert(
    playingHover.maxHoverOpacity < 0.05,
    `playing: no hover line (opacity=${playingHover.maxHoverOpacity})`,
  );
  assert(
    playingHover.mapHover === "0" || playingHover.mapHover == null,
    `playing: map hover off (got ${playingHover.mapHover})`,
  );
  assert(playingHover.ghostCount === 0, "playing: no ghost marker");

  // Hover map while playing — still no preview.
  const mapEl =
    (await page.locator("[data-apex-map='chase']").count()) > 0
      ? page.locator("[data-apex-map='chase']")
      : page.locator(".leaflet-container").first();
  const mapBox = await mapEl.boundingBox();
  if (mapBox) {
    await page.mouse.move(
      mapBox.x + mapBox.width * 0.5,
      mapBox.y + mapBox.height * 0.5,
    );
    await page.waitForTimeout(250);
    const mapHoverWhilePlaying = await hoverOpacity(page);
    assert(
      mapHoverWhilePlaying.ghostCount === 0,
      "playing+map hover: no ghost",
    );
    assert(
      mapHoverWhilePlaying.maxHoverOpacity < 0.05,
      "playing+map hover: no chart hover line",
    );
  }

  // Click chart while playing still seeks (and typically pauses).
  const before = await playbackProgress(page);
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.5);
  await page.waitForTimeout(500);
  const after = await playbackProgress(page);
  assert(before != null && after != null, "scrub progress readable");
  assert(
    Math.abs(after - before) > 0.02 ||
      (await playBtn.first().getAttribute("aria-label")) === "Play",
    `click while playing seeks (before=${before}, after=${after})`,
  );

  // Ensure paused, then hover preview returns.
  if ((await playBtn.first().getAttribute("aria-label")) === "Pause") {
    await playBtn.first().click();
    await page.waitForTimeout(300);
  }
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45);
  await page.waitForTimeout(250);
  const resumedHover = await hoverOpacity(page);
  assert(resumedHover.hoverEnabled === "1", "paused again: hover enabled");
  assert(
    resumedHover.maxHoverOpacity > 0.5,
    `paused again: hover line visible (opacity=${resumedHover.maxHoverOpacity})`,
  );

  const shot = path.join(outDir, "hover_disable_while_playing_proof.png");
  await page.screenshot({ path: shot, fullPage: false });

  const result = {
    ok: true,
    url,
    viewport: "1440x900",
    pausedHover,
    playingHover,
    beforeSeek: before,
    afterSeek: after,
    resumedHover,
    screenshot: shot,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(
    path.join(outDir, "hover_disable_while_playing_result.json"),
    JSON.stringify(result, null, 2),
  );

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
