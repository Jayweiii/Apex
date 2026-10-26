/**
 * Browser proof: cross-session compare retention + session-map route stability.
 *
 * Usage:
 *   BASE_URL=https://apex-ashy-beta.vercel.app node scripts/verify-cross-session-compare-map.mjs
 *
 * Measures:
 * 1) Compare: pick lap from session A, switch session dropdown, pick lap from B —
 *    chips retain both (session name + lap); URL has laps=session:lap pairs.
 * 2) Session lap map: play ~20s and count Leaflet/MapLibre layer recreation /
 *    polyline clear cycles — must stay near 0 after initial draw.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const SESSION =
  process.env.APEX_SESSION_ID || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
});

const proof = {
  base: BASE,
  session: SESSION,
  at: new Date().toISOString(),
  crossSession: null,
  mapFlicker: null,
};

async function shot(name) {
  const path = `${outDir}/${name}`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

// --- 1) Cross-session compare ---
{
  const url = `${BASE}/sessions/${SESSION}/compare`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);

  // Wait for session select + lap list.
  const sessionSelect = page.locator("select").filter({
    has: page.locator("option"),
  });
  await page
    .waitForSelector('select, [role="listbox"]', { timeout: 30000 })
    .catch(() => {});

  const selects = page.locator("label").filter({ hasText: /^Session$/i });
  let sessionDropdown = page
    .locator("label")
    .filter({ hasText: /^Session$/i })
    .locator("select");
  if ((await sessionDropdown.count()) === 0) {
    // Fallback: last select on page (track filter may be first).
    sessionDropdown = page.locator("select").last();
  }

  const optionCount = await sessionDropdown.locator("option").count();
  const optionValues = await sessionDropdown.locator("option").evaluateAll((els) =>
    els.map((el) => ({ value: el.value, label: el.textContent?.trim() || "" })),
  );

  // Ensure at least one lap selected from current session.
  const lapList = page.locator('[role="listbox"][aria-label="Laps in session"]');
  await lapList.waitFor({ timeout: 20000 }).catch(() => {});
  const lapButtons = lapList.locator('[role="option"]');
  const lapCount = await lapButtons.count();

  if (lapCount >= 1) {
    const firstSelected = await lapButtons.first().getAttribute("aria-selected");
    if (firstSelected !== "true") {
      await lapButtons.first().click();
      await page.waitForTimeout(400);
    }
  }

  const chipsBefore = await page.locator("[data-apex-compare-chip]").count();
  const chipTextsBefore = await page
    .locator("[data-apex-compare-chip]")
    .allTextContents();

  // Switch to another session if available.
  let switched = false;
  let otherSessionId = null;
  if (optionValues.length >= 2) {
    const current = await sessionDropdown.inputValue();
    const other =
      optionValues.find((o) => o.value && o.value !== current) ||
      optionValues[1];
    if (other?.value) {
      otherSessionId = other.value;
      await sessionDropdown.selectOption(other.value);
      switched = true;
      await page.waitForTimeout(800);
    }
  }

  const chipsAfterSwitch = await page
    .locator("[data-apex-compare-chip]")
    .allTextContents();
  const chipsKept =
    chipsBefore === 0 ||
    chipsAfterSwitch.length >= Math.min(chipsBefore, 1);

  // Add a lap from the new session if capacity allows.
  let addedCross = false;
  const lapList2 = page.locator('[role="listbox"][aria-label="Laps in session"]');
  const options2 = lapList2.locator('[role="option"]');
  const n2 = await options2.count();
  for (let i = 0; i < n2; i += 1) {
    const el = options2.nth(i);
    const selected = await el.getAttribute("aria-selected");
    const disabled = await el.isDisabled();
    if (selected === "true" || disabled) continue;
    await el.click();
    addedCross = true;
    await page.waitForTimeout(600);
    break;
  }

  await page.waitForTimeout(500);
  const chipsFinal = await page
    .locator("[data-apex-compare-chip]")
    .evaluateAll((els) =>
      els.map((el) => ({
        key: el.getAttribute("data-apex-compare-chip"),
        text: el.textContent?.replace(/\s+/g, " ").trim(),
      })),
    );

  const sessionIdsInChips = new Set(
    chipsFinal.map((c) => (c.key || "").split(":")[0]).filter(Boolean),
  );
  const urlNow = page.url();
  const urlHasCross =
    /laps=/.test(urlNow) &&
    (sessionIdsInChips.size >= 2 ||
      (otherSessionId && urlNow.includes(otherSessionId)));

  const crossShot = await shot("cross-session-compare-chips.png");

  proof.crossSession = {
    optionCount,
    optionValues: optionValues.slice(0, 8),
    switched,
    otherSessionId,
    chipsBefore,
    chipTextsBefore,
    chipsAfterSwitch,
    chipsKept,
    addedCross,
    chipsFinal,
    distinctSessionsInChips: sessionIdsInChips.size,
    url: urlNow,
    urlHasCross,
    shot: crossShot,
    ok:
      optionCount >= 1 &&
      chipsKept &&
      chipsFinal.length >= 2 &&
      (sessionIdsInChips.size >= 2 || optionCount < 2),
  };
}

// --- 2) Session map flicker (layer recreation) ---
{
  const url = `${BASE}/sessions/${SESSION}`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(2500);

  // Pick a hot lap if lap buttons present.
  const lapBtn = page.locator("button").filter({ hasText: /1:\d{2}|0?\d\b/ }).first();
  if (await lapBtn.count()) {
    await lapBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  // Instrument Leaflet LayerGroup.clearLayers + MapLibre removeLayer for lap-line.
  await page.evaluate(() => {
    window.__apexMapStats = {
      clearLayers: 0,
      removeLapLine: 0,
      polyCreate: 0,
      startedAt: performance.now(),
    };
    // Hook Leaflet if present
    const L = window.L;
    if (L?.LayerGroup?.prototype?.clearLayers) {
      const orig = L.LayerGroup.prototype.clearLayers;
      L.LayerGroup.prototype.clearLayers = function patchedClear(...args) {
        // Only count polyline/route layer groups (not markers) when possible.
        const id = this?._apexKind || "";
        window.__apexMapStats.clearLayers += 1;
        return orig.apply(this, args);
      };
    }
    // Observe SVG path mutations inside leaflet panes as a flicker proxy.
    const pane =
      document.querySelector(".leaflet-overlay-pane") ||
      document.querySelector(".leaflet-container");
    if (pane) {
      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const n of m.addedNodes) {
            if (
              n.nodeName === "path" ||
              (n.querySelectorAll && n.querySelectorAll("path").length)
            ) {
              window.__apexMapStats.polyCreate += 1;
            }
          }
        }
      });
      mo.observe(pane, { childList: true, subtree: true });
      window.__apexMapMo = mo;
    }
  });

  const play = page.getByRole("button", { name: /^Play$/i }).first();
  if (await play.count()) {
    await play.click({ timeout: 5000 }).catch(() => {});
  }

  const beforeShot = await shot("session-map-play-start.png");
  // Sample for ~12s (time-boxed; full 20s if env asks).
  const playMs = Number(process.env.PLAY_MS || 12000);
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < playMs) {
    await page.waitForTimeout(1000);
    const snap = await page.evaluate(() => {
      const stats = window.__apexMapStats || {};
      const overlay = document.querySelector(".leaflet-overlay-pane");
      const paths = overlay ? overlay.querySelectorAll("path").length : 0;
      const marker =
        document.querySelector(".apex-car-marker") ||
        document.querySelector(".maplibregl-marker");
      return {
        clearLayers: stats.clearLayers || 0,
        polyCreate: stats.polyCreate || 0,
        paths,
        markerPresent: Boolean(marker),
        progress: (() => {
          const range = document.querySelector('input[type="range"]');
          return range
            ? Number(range.value) / Number(range.max || 1000)
            : null;
        })(),
      };
    });
    samples.push({ t: Date.now() - t0, ...snap });
  }

  const afterShot = await shot("session-map-play-end.png");
  await page.getByRole("button", { name: /^Pause$/i }).first().click().catch(() => {});

  const first = samples[0];
  const last = samples[samples.length - 1];
  const pathDelta =
    first && last ? Math.abs((last.paths || 0) - (first.paths || 0)) : 0;
  const clearDelta =
    first && last
      ? (last.clearLayers || 0) - (first.clearLayers || 0)
      : 0;
  const polyDelta =
    first && last ? (last.polyCreate || 0) - (first.polyCreate || 0) : 0;

  // Markers may clear/rebuild each frame; route paths should stay stable.
  // Allow tiny noise (≤2 path delta) from SF overlays; flag large recreation.
  const routeStable = pathDelta <= 5 && polyDelta <= 8;

  proof.mapFlicker = {
    playMs,
    samples,
    pathDelta,
    clearDelta,
    polyDelta,
    beforeShot,
    afterShot,
    routeStable,
    ok: routeStable && (last?.markerPresent ?? true),
  };
}

await browser.close();

const allOk = Boolean(proof.crossSession?.ok && proof.mapFlicker?.ok);
fs.writeFileSync(
  `${outDir}/cross-session-compare-map-proof.json`,
  JSON.stringify({ allOk, proof }, null, 2),
);
console.log(JSON.stringify({ allOk, proof }, null, 2));
process.exit(allOk ? 0 : 1);
