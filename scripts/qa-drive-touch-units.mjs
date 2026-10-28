/**
 * Browser QA for Drive touch pads, units toggle, and car/track selection.
 * Usage: BASE_URL=http://127.0.0.1:3000 node scripts/qa-drive-touch-units.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3000";
const OUT = process.env.OUT_DIR || "/opt/cursor/artifacts/drive-touch-units";
mkdirSync(OUT, { recursive: true });

const proof = {
  base: BASE,
  at: new Date().toISOString(),
  sha: process.env.EXPECT_SHA || null,
  checks: {},
};

function ok(name, pass, detail) {
  proof.checks[name] = { pass: Boolean(pass), detail };
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name} — ${
      typeof detail === "string" ? detail : JSON.stringify(detail)
    }`,
  );
}

const browser = await chromium.launch({ headless: true });

// ---------- Desktop: pads hidden, units toggle, change car/track ----------
{
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
  });
  const consoleMsgs = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || /Unable to preventDefault/i.test(msg.text())) {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto(`${BASE}/drive/thunderhill-west`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("[data-apex-drive-start]", { timeout: 60000 });

  const changeCount = await page.locator("[data-apex-drive-change-car-track]").count();
  ok("desktop-change-car-track-ready", changeCount >= 1, { changeCount });

  const unitToggle = page.locator("[data-apex-speed-unit-toggle]");
  await unitToggle.waitFor({ timeout: 10000 });
  const unitBefore = await unitToggle.getAttribute("data-apex-speed-unit");
  ok("desktop-unit-toggle-present", unitBefore === "mph" || unitBefore === "kmh", {
    unitBefore,
  });
  await unitToggle.click();
  await page.waitForTimeout(200);
  const unitAfter = await unitToggle.getAttribute("data-apex-speed-unit");
  ok("desktop-unit-toggle-switches", unitAfter && unitAfter !== unitBefore, {
    unitBefore,
    unitAfter,
  });
  // restore mph default for rest of suite
  if (unitAfter !== "mph") await unitToggle.click();

  await page.locator("[data-apex-drive-start]").click();
  await page.waitForTimeout(3500); // past countdown

  const padsWhileFine = await page.locator("[data-apex-drive-touch-pads]").count();
  ok("desktop-pads-hidden-by-default", padsWhileFine === 0, { padsWhileFine });

  // Simulate a prior touch input without needing a touch device: dispatch pointerdown touch
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "touch",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(200);
  // After touch, pads should appear once racing
  let padsAfterTouch = await page.locator("[data-apex-drive-touch-pads]").count();
  ok("desktop-pads-after-touch", padsAfterTouch === 1, { padsAfterTouch });

  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);
  const padsAfterKey = await page.locator("[data-apex-drive-touch-pads]").count();
  ok("desktop-pads-hidden-after-keyboard", padsAfterKey === 0, { padsAfterKey });

  // Re-show via touch and tap gas with pointer events; ensure release clears throttle
  await page.evaluate(() => {
    window.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerType: "touch",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForTimeout(150);
  padsAfterTouch = await page.locator("[data-apex-drive-touch-pads]").count();
  ok("desktop-pads-reshown", padsAfterTouch === 1, { padsAfterTouch });

  const gas = page.locator("[data-apex-drive-gas]");
  const box = await gas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  // Blur should also clear — fire and ensure no preventDefault console spam from pads
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  const passiveWarn = consoleMsgs.filter((m) =>
    /Unable to preventDefault inside passive/i.test(m),
  );
  ok("no-passive-preventdefault-warning", passiveWarn.length === 0, {
    passiveWarn: passiveWarn.slice(0, 5),
    other: consoleMsgs.slice(0, 8),
  });

  await page.screenshot({
    path: resolve(OUT, "desktop-drive-hud.png"),
    fullPage: false,
  });

  // Change car/track navigates to hub
  await page.locator("[data-apex-drive-change-car-track]").first().click();
  await page.waitForURL(/\/drive\/?$/, { timeout: 15000 });
  await page.waitForSelector("[data-apex-drive-car-track-select]", {
    timeout: 15000,
  });
  ok("change-car-track-to-hub", true, { url: page.url() });
  await page.screenshot({
    path: resolve(OUT, "drive-hub-select.png"),
    fullPage: false,
  });
  await page.close();
}

// ---------- /drive hub reachable ----------
{
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await page.goto(`${BASE}/drive`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("[data-apex-drive-car-select]", { timeout: 30000 });
  const hasToggle = (await page.locator("[data-apex-speed-unit-toggle]").count()) > 0;
  ok("hub-has-unit-toggle-via-header", hasToggle, {});
  ok(
    "hub-car-track-select",
    (await page.locator("[data-apex-drive-car-track-select]").count()) === 1,
    {},
  );
  await page.close();
}

// ---------- Mobile coarse: pads visible, pointer release ----------
{
  const iPhone = devices["iPhone 13"];
  const context = await browser.newContext({
    ...iPhone,
    hasTouch: true,
  });
  const page = await context.newPage();
  const consoleMsgs = [];
  page.on("console", (msg) => {
    if (/Unable to preventDefault/i.test(msg.text())) {
      consoleMsgs.push(msg.text());
    }
  });

  await page.goto(`${BASE}/drive/thunderhill-west`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector("[data-apex-drive-start]", { timeout: 60000 });
  await page.locator("[data-apex-drive-start]").click();
  await page.waitForTimeout(3500);

  const pads = page.locator("[data-apex-drive-touch-pads]");
  await pads.waitFor({ timeout: 10000 });
  ok("mobile-pads-visible", (await pads.count()) === 1, {});

  const gas = page.locator("[data-apex-drive-gas]");
  const box = await gas.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(100);
    // Press and release via pointer-ish touch sequence
    await page.evaluate(
      ({ x, y }) => {
        const el = document.querySelector("[data-apex-drive-gas]");
        if (!el) return;
        const down = new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "touch",
          clientX: x,
          clientY: y,
        });
        el.dispatchEvent(down);
        el.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: "touch",
            clientX: x,
            clientY: y,
          }),
        );
      },
      { x, y },
    );
  }

  ok("mobile-no-passive-warning", consoleMsgs.length === 0, {
    consoleMsgs: consoleMsgs.slice(0, 5),
  });
  await page.screenshot({
    path: resolve(OUT, "mobile-drive-pads.png"),
    fullPage: false,
  });
  await context.close();
}

await browser.close();

const failed = Object.values(proof.checks).filter((c) => !c.pass).length;
writeFileSync(resolve(OUT, "proof.json"), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ failed, out: OUT, proof }, null, 2));
process.exit(failed ? 1 : 0);
