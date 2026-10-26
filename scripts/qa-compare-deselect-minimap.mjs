/**
 * Focused browser proof: compare L3 deselect-from-2 + chip ×/ref,
 * Drive mobile minimap clear of Brake/Gas.
 *
 * Usage: BASE_URL=... VERCEL_SHARE=... node scripts/qa-compare-deselect-minimap.mjs
 */
import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
const SESSION = "1aa2fb88-8204-4abb-b745-520ea99819dd";
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

async function withShare(page) {
  const share = process.env.VERCEL_SHARE || process.env.VERCEL_SHARE_COOKIE;
  if (!share) return;
  const url = new URL(BASE);
  await page.context().addCookies([
    {
      name: "_vercel_share",
      value: share.replace(/^_vercel_share=/, ""),
      domain: url.hostname,
      path: "/",
    },
  ]);
}

async function compareState(page) {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll("[data-apex-compare-chip]")].map(
      (el) => ({
        key: el.getAttribute("data-apex-compare-chip"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
        // "Ref" sits next to the mono time with no word boundary (…731Ref).
        isRef: /Ref/.test(el.textContent || ""),
      }),
    );
    const options = [...document.querySelectorAll('[role="option"]')].map(
      (el, index) => ({
        index,
        label: el.querySelector("span")?.textContent?.trim() || "",
        selected: el.getAttribute("aria-selected") === "true",
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48),
      }),
    );
    return {
      chips,
      options,
      selected: options.filter((o) => o.selected).map((o) => o.label),
      url: location.href,
    };
  });
}

async function clickOptionLabel(page, label) {
  const idx = await page.evaluate((want) => {
    const rows = [...document.querySelectorAll('[role="option"]')];
    return rows.findIndex(
      (el) => el.querySelector("span")?.textContent?.trim() === want,
    );
  }, label);
  if (idx < 0) throw new Error(`option ${label} not found`);
  await page.locator('[role="option"]').nth(idx).click();
  return idx;
}

const browser = await chromium.launch({ headless: true });

// ---------- Compare deselect ----------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await withShare(page);
  await page.goto(`${BASE}/sessions/${SESSION}/compare`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForSelector('[role="option"]', { timeout: 60000 });
  await page.waitForTimeout(3000);

  // Trim extras via × until ≤2.
  for (let i = 0; i < 4; i += 1) {
    const n = await page.locator("[data-apex-compare-chip]").count();
    if (n <= 2) break;
    await page.locator("[data-apex-compare-remove]").last().click();
    await page.waitForTimeout(300);
  }

  let state = await compareState(page);
  if (!state.selected.includes("L3")) {
    // Make room then add L3.
    if (state.chips.length >= 2) {
      const nonRef = page.locator(
        "[data-apex-compare-chip]:not(:has-text('Ref')) [data-apex-compare-remove]",
      );
      if ((await nonRef.count()) > 0) {
        await nonRef.first().click();
        await page.waitForTimeout(300);
      }
    }
    await clickOptionLabel(page, "L3");
    await page.waitForTimeout(400);
    state = await compareState(page);
  }
  // Ensure exactly 2: if more, remove non-L3 non-ref first.
  while ((await page.locator("[data-apex-compare-chip]").count()) > 2) {
    await page.locator("[data-apex-compare-remove]").last().click();
    await page.waitForTimeout(300);
  }
  // If only L3, add another (L6 preferred).
  state = await compareState(page);
  if (state.chips.length < 2) {
    const other =
      state.options.find((o) => !o.selected && o.label === "L6") ||
      state.options.find((o) => !o.selected);
    if (other) {
      await page.locator('[role="option"]').nth(other.index).click();
      await page.waitForTimeout(400);
    }
  }

  const before = await compareState(page);
  ok(
    "compare-start-two-with-l3",
    before.chips.length === 2 && before.selected.includes("L3"),
    before,
  );

  // Deselect L3 via row click (the reported failure at 2/4).
  await clickOptionLabel(page, "L3");
  await page.waitForTimeout(600);
  let after = await compareState(page);
  const deselected =
    !after.selected.includes("L3") &&
    after.chips.length === 1 &&
    !after.chips.some((c) => /\bL3\b/.test(c.text));
  ok("compare-l3-deselected", deselected, after);

  // Stay deselected (URL/default must not re-add).
  await page.waitForTimeout(2000);
  after = await compareState(page);
  const stayed =
    !after.selected.includes("L3") &&
    after.chips.length === 1 &&
    !after.chips.some((c) => /\bL3\b/.test(c.text)) &&
    !/L3|:[^,]*,/.test(after.url) === false
      ? !after.url.includes("L3") ||
        !decodeURIComponent(after.url).match(/laps=[^&]*L3/i)
      : true;
  // Stronger: chip/selection stay off; URL should not list two slots with L3.
  const urlHasL3 = /laps=[^&]*L3/i.test(decodeURIComponent(after.url));
  const stayedOff =
    !after.selected.includes("L3") &&
    after.chips.length === 1 &&
    !after.chips.some((c) => /\bL3\b/.test(c.text)) &&
    !urlHasL3;
  await page.screenshot({
    path: resolve(OUT, "qa-compare-l3-deselected.png"),
    fullPage: false,
  });
  ok("compare-l3-stays-deselected", stayedOff, { after, urlHasL3, stayed });

  // Re-add L3, change ref via Set ref, remove via ×.
  await clickOptionLabel(page, "L3");
  await page.waitForTimeout(400);
  const setRef = page.locator("[data-apex-compare-set-ref]").first();
  let refOk = false;
  if ((await setRef.count()) > 0) {
    const key = await setRef.getAttribute("data-apex-compare-set-ref");
    await setRef.click();
    await page.waitForTimeout(350);
    refOk = await page.evaluate((k) => {
      const chip = document.querySelector(`[data-apex-compare-chip="${k}"]`);
      return /Ref/.test(chip?.textContent || "");
    }, key);
  }
  const beforeX = (await compareState(page)).chips.length;
  const removeBtn = page.locator("[data-apex-compare-remove]").first();
  ok("compare-chip-x-present", (await removeBtn.count()) > 0 && beforeX >= 2, {
    beforeX,
  });
  if ((await removeBtn.count()) > 0) {
    await removeBtn.click();
    await page.waitForTimeout(500);
  }
  const afterX = await compareState(page);
  await page.screenshot({
    path: resolve(OUT, "qa-compare-chip-x-ref.png"),
    fullPage: false,
  });
  ok(
    "compare-ref-and-chip-x",
    refOk && afterX.chips.length === beforeX - 1,
    { refOk, beforeX, after: afterX },
  );
  await page.close();
}

// ---------- Drive mobile minimap ----------
{
  const mobile = await browser.newPage({ ...devices["iPhone 12"] });
  await withShare(mobile);
  await mobile.goto(`${BASE}/drive/thunderhill-west`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await mobile.waitForTimeout(3500);
  await mobile.getByRole("button", { name: /Start driving/i }).click();
  await mobile.waitForTimeout(1800);

  const layout = await mobile.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const buttons = [...document.querySelectorAll("button")].filter((b) =>
      /^(Brake|Gas)$/i.test((b.textContent || "").trim()),
    );
    if (!canvas || buttons.length < 2) {
      return { ok: false, reason: "missing canvas or buttons" };
    }
    const c = canvas.getBoundingClientRect();
    const btnBoxes = buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: (b.textContent || "").trim(),
        x: r.x,
        y: r.y,
        r: r.right,
        b: r.bottom,
      };
    });
    const size = Math.max(96, Math.min(148, Math.floor(c.width * 0.22)));
    const mini = {
      x: c.right - size - 10,
      y: c.top + 10 + 58,
      r: c.right - 10,
      b: c.top + 10 + 58 + size,
    };
    const overlaps = btnBoxes.some(
      (b) => !(b.r < mini.x || b.x > mini.r || b.b < mini.y || b.y > mini.b),
    );
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { width, height } = canvas;
    const sample = (x0, y0, x1, y1) => {
      const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 45) dark += 1;
      }
      return dark;
    };
    const topRightDark = sample(
      Math.floor(width * 0.7),
      Math.floor(height * 0.04),
      width,
      Math.floor(height * 0.4),
    );
    const bottomRightDark = sample(
      Math.floor(width * 0.7),
      Math.floor(height * 0.7),
      width,
      height,
    );
    return {
      ok: true,
      overlaps,
      mini,
      btnBoxes,
      topRightDark,
      bottomRightDark,
      size,
    };
  });

  await mobile.screenshot({
    path: resolve(OUT, "qa-drive-mobile-minimap-top.png"),
    fullPage: false,
  });
  ok(
    "drive-mobile-minimap-top-clear",
    layout.ok &&
      !layout.overlaps &&
      (layout.topRightDark ?? 0) > 40 &&
      (layout.topRightDark ?? 0) > (layout.bottomRightDark ?? 0),
    layout,
  );
  await mobile.close();
}

await browser.close();

const failed = Object.values(proof.checks).filter((c) => !c.pass).length;
proof.failed = failed;
writeFileSync(
  resolve(OUT, "qa-compare-deselect-minimap.json"),
  JSON.stringify(proof, null, 2),
);
console.log(`\n${failed} failed — wrote ${OUT}/qa-compare-deselect-minimap.json`);
process.exit(failed ? 1 : 0);
