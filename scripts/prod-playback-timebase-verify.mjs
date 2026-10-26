/**
 * PRODUCTION: measure chart cursor time vs map marker time sync + playback
 * cursor overlay (no flicker remount).
 *
 * Usage: node scripts/prod-playback-timebase-verify.mjs [sessionId]
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const baseUrl = process.env.APEX_PROD_URL || "https://apex-ashy-beta.vercel.app";
const outDir = "/opt/cursor/artifacts";
fs.mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900, device: null },
  {
    name: "iphone-390x844",
    width: 390,
    height: 844,
    device: devices["iPhone 12"],
  },
];

async function selectHotLap(page) {
  const candidates = [
    page.getByRole("button", { name: /^0?2\b/ }),
    page.locator("button").filter({ hasText: /^0?2$/ }),
    page.locator("button").filter({ hasText: /1:\d{2}/ }),
  ];
  for (const loc of candidates) {
    if ((await loc.count()) > 0) {
      try {
        await loc.first().click({ timeout: 2000 });
        await page.waitForTimeout(1500);
        break;
      } catch {
        /* try next */
      }
    }
  }
}

async function measureSync(page) {
  // Prefer play button in lap playback controls.
  const play = page.getByRole("button", { name: /^Play$/i }).first();
  if (await play.count()) {
    await play.click({ timeout: 3000 }).catch(() => {});
  }

  await page.waitForTimeout(800);

  const samples = await page.evaluate(async () => {
    const results = [];
    const frameMs = 1000 / 60;

    const read = () => {
      const playLine = document.querySelector('[data-apex-playback-line="1"]');
      const hoverLine = document.querySelector('[data-apex-hover-line="1"]');
      const plot =
        document.querySelector('[data-apex-chart-plot="speed"]') ||
        document.querySelector(".recharts-wrapper");
      const marker =
        document.querySelector(".apex-car-marker") ||
        document.querySelector(".maplibregl-marker") ||
        document.querySelector(".leaflet-marker-icon.apex-car-marker, .apex-car-marker__dot")?.closest(
          ".leaflet-marker-icon, .maplibregl-marker",
        );

      let playOpacity = null;
      let playX = null;
      if (playLine) {
        const style = getComputedStyle(playLine);
        playOpacity = Number(style.opacity || playLine.style.opacity || 0);
        const transform = playLine.style.transform || style.transform || "";
        const m = /translate3d\(([-\d.]+)px/.exec(transform);
        playX = m ? Number(m[1]) : null;
      }

      // Infer chart time from playback line X within plot pad.
      let chartTimeSec = null;
      let chartFraction = null;
      if (plot && playX != null) {
        const rect = plot.getBoundingClientRect();
        const padL = 48;
        const padR = 8;
        const inner = Math.max(1, rect.width - padL - padR);
        chartFraction = Math.min(1, Math.max(0, (playX - padL) / inner));
      }

      // Read scrubber progress as shared clock.
      const range = document.querySelector('input[type="range"]');
      let progress = null;
      if (range) progress = Number(range.value) / Number(range.max || 1000);

      // Map marker screen position (presence check).
      let markerOk = false;
      if (marker) {
        const r = marker.getBoundingClientRect();
        markerOk = r.width > 0 && r.height > 0;
      }

      const debug = document.querySelector("[data-apex-playback-sync]");
      const mapT = debug ? Number(debug.dataset.apexMapT) : null;
      const chartT = debug ? Number(debug.dataset.apexChartT) : null;
      const playbackT = debug ? Number(debug.dataset.apexPlaybackT) : null;
      const dt =
        mapT != null && chartT != null && Number.isFinite(mapT) && Number.isFinite(chartT)
          ? Math.abs(mapT - chartT)
          : null;

      return {
        playOpacity,
        playX,
        chartFraction,
        progress,
        markerOk,
        mapT,
        chartT,
        playbackT,
        dt,
        hoverOpacity: hoverLine
          ? Number(getComputedStyle(hoverLine).opacity || 0)
          : null,
        playLineCount: document.querySelectorAll(
          '[data-apex-playback-line="1"]',
        ).length,
        transition:
          playLine?.style.transition ||
          (playLine ? getComputedStyle(playLine).transition : null),
      };
    };

    for (let i = 0; i < 8; i += 1) {
      results.push(read());
      await new Promise((r) => setTimeout(r, frameMs * 4));
    }
    return results;
  });

  // Pause
  const pause = page.getByRole("button", { name: /^Pause$/i }).first();
  if (await pause.count()) {
    await pause.click({ timeout: 2000 }).catch(() => {});
  }

  // Scrub to several progress points and compare line fraction ≈ range.
  const scrubSamples = [];
  for (const target of [0.15, 0.35, 0.55, 0.75]) {
    await page.evaluate((t) => {
      const range = document.querySelector('input[type="range"]');
      if (!range) return;
      const max = Number(range.max || 1000);
      range.value = String(Math.round(t * max));
      range.dispatchEvent(new Event("input", { bubbles: true }));
      range.dispatchEvent(new Event("change", { bubbles: true }));
    }, target);
    await page.waitForTimeout(400);
    const snap = await page.evaluate(() => {
      const range = document.querySelector('input[type="range"]');
      const progress = range
        ? Number(range.value) / Number(range.max || 1000)
        : null;
      const playLine = document.querySelector('[data-apex-playback-line="1"]');
      const plot =
        document.querySelector('[data-apex-chart-plot="speed"]') ||
        document.querySelector(".recharts-wrapper");
      let chartFraction = null;
      if (playLine && plot) {
        const transform = playLine.style.transform || "";
        const m = /translate3d\(([-\d.]+)px/.exec(transform);
        const playX = m ? Number(m[1]) : null;
        if (playX != null) {
          const rect = plot.getBoundingClientRect();
          const padL = 48;
          const padR = 8;
          const inner = Math.max(1, rect.width - padL - padR);
          chartFraction = Math.min(1, Math.max(0, (playX - padL) / inner));
        }
      }
      const marker =
        document.querySelector(".apex-car-marker") ||
        document.querySelector(".maplibregl-marker");
      const debug = document.querySelector("[data-apex-playback-sync]");
      const mapT = debug ? Number(debug.dataset.apexMapT) : null;
      const chartT = debug ? Number(debug.dataset.apexChartT) : null;
      const dt =
        mapT != null && chartT != null && Number.isFinite(mapT) && Number.isFinite(chartT)
          ? Math.abs(mapT - chartT)
          : null;
      return {
        progress,
        chartFraction,
        markerOk: Boolean(marker),
        playOpacity: playLine
          ? Number(getComputedStyle(playLine).opacity || playLine.style.opacity || 0)
          : 0,
        mapT,
        chartT,
        dt,
      };
    });
    scrubSamples.push({ target, ...snap });
  }

  return { playingSamples: samples, scrubSamples };
}

const report = {
  ok: false,
  url: `${baseUrl}/sessions/${sessionId}`,
  commitHint: null,
  viewports: {},
};

for (const vp of viewports) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    vp.device
      ? { ...vp.device, viewport: { width: vp.width, height: vp.height } }
      : { viewport: { width: vp.width, height: vp.height } },
  );
  const page = await context.newPage();
  await page.goto(report.url, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  await selectHotLap(page);

  // Capture build id if exposed
  try {
    const sha = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="vercel-deployment-id"]');
      return meta?.getAttribute("content") || document.body?.dataset?.commit || null;
    });
    if (sha) report.commitHint = sha;
  } catch {
    /* ignore */
  }

  const measured = await measureSync(page);
  const shot = path.join(outDir, `playback-timebase-${vp.name}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  // Within 1 frame @ 60fps ≈ 16.7ms. Allow 25ms for probe + GPS sample step.
  const FRAME_SEC = 1 / 60;
  const scrubOk = measured.scrubSamples.every((s) => {
    if (s.dt == null) return false;
    return s.dt <= FRAME_SEC * 1.5 && s.playOpacity > 0.5 && s.markerOk;
  });
  const playingDtOk = measured.playingSamples
    .filter((s) => s.dt != null)
    .every((s) => s.dt <= FRAME_SEC * 1.5);

  const playingLines = measured.playingSamples.filter(
    (s) => (s.playLineCount ?? 0) > 0,
  );
  const noTransition = measured.playingSamples.every(
    (s) => !s.transition || s.transition === "none" || s.transition === "",
  );
  const hoverOffWhilePlaying = measured.playingSamples.every(
    (s) => (s.hoverOpacity ?? 0) < 0.05,
  );

  const maxDt = Math.max(
    0,
    ...measured.scrubSamples.map((s) => s.dt ?? 0),
    ...measured.playingSamples.map((s) => s.dt ?? 0),
  );

  report.viewports[vp.name] = {
    screenshot: shot,
    scrubOk,
    playingDtOk,
    maxDtSec: maxDt,
    frameBudgetSec: FRAME_SEC * 1.5,
    scrubSamples: measured.scrubSamples,
    playingSampleCount: measured.playingSamples.length,
    playLinePresent: playingLines.length > 0,
    noTransition,
    hoverOffWhilePlaying,
    sample0: measured.playingSamples[0] ?? null,
  };

  await browser.close();
}

report.ok = Object.values(report.viewports).every(
  (v) =>
    v.scrubOk &&
    v.playingDtOk &&
    v.playLinePresent &&
    v.noTransition,
);

const outJson = path.join(outDir, "playback-timebase-verify.json");
fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
