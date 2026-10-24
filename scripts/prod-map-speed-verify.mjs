/**
 * Measure map + speed chart on PRODUCTION for a public session.
 * Usage: node scripts/prod-map-speed-verify.mjs [sessionId] [label]
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const sessionId =
  process.argv[2] || "1aa2fb88-8204-4abb-b745-520ea99819dd";
const label = process.argv[3] || "before";
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

async function measure(page) {
  await page.waitForTimeout(2500);
  // Prefer a hot lap (~1–2 min), not the short in-lap marked "Best".
  // Lap list buttons often show "02" / "2" / "Lap 2".
  const candidates = [
    page.getByRole("button", { name: /^0?2\b/ }),
    page.locator("button").filter({ hasText: /^0?2$/ }),
    page.locator("button").filter({ hasText: /1:\d{2}/ }),
  ];
  for (const loc of candidates) {
    if ((await loc.count()) > 0) {
      try {
        await loc.first().click({ timeout: 2000 });
        await page.waitForTimeout(2000);
        break;
      } catch {
        /* try next */
      }
    }
  }

  return page.evaluate(() => {
    const map =
      document.querySelector('[data-apex-map="chase"]') ||
      document.querySelector('[data-apex-map="fixed-scrub"]') ||
      document.querySelector(".maplibregl-map") ||
      document.querySelector(".leaflet-container");
    const speed =
      document.querySelector('[data-apex-chart-plot="speed"]') ||
      document.querySelector('[data-apex-chart-plot="speed"] svg')?.parentElement;

    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        width: Math.round(r.width),
        height: Math.round(r.height),
        top: Math.round(r.top),
        left: Math.round(r.left),
      };
    };

    const countSpeedPathPoints = () => {
      const plot = document.querySelector('[data-apex-chart-plot="speed"]');
      if (!plot) return { paths: 0, points: 0, dLengths: [], curvePoints: 0 };
      // Prefer the stroked speed line (not fill area).
      const paths = [...plot.querySelectorAll("path")].filter((p) => {
        const d = p.getAttribute("d") || "";
        const fill = (p.getAttribute("fill") || "").toLowerCase();
        const stroke = p.getAttribute("stroke");
        return (
          d.length > 40 &&
          /[MLCQl]/.test(d) &&
          (stroke || fill === "none" || fill === "transparent")
        );
      });
      let maxPoints = 0;
      let curvePoints = 0;
      const dLengths = [];
      for (const p of paths) {
        const d = p.getAttribute("d") || "";
        dLengths.push(d.length);
        const cmds = d.match(/[ML]/Qml]/q]/s]/t]/a]/h]/v]/z]/z]/s]/t]/a]/h]/v]/z]/s]/t]/a]/h]/v|/g);
        // Count L/C segments as points along the polyline.
        const L = (d.match(/[Ll]/g) || []).length;
        const C = (d.match(/[Cc]/g) || []).length;
        const M = (d.match(/[Mm]/g) || []).length;
        const pts = Math.max(L + C + M, Math.floor((d.match(/-?\d+(?:\.\d+)?/g) || []).length / 2));
        if (pts > maxPoints) maxPoints = pts;
        if (C > curvePoints) curvePoints = C;
      }
      // Also count Recharts dots if present
      const dots = plot.querySelectorAll("circle.recharts-dot, .recharts-line-dots circle").length;
      return {
        paths: paths.length,
        points: Math.max(maxPoints, dots),
        dLengths,
        curvePoints,
        dots,
        peakText: document.body.innerText.match(/Peak\s+([\d.]+)\s*km\/h/i)?.[1] ?? null,
        selectedLap: document.body.innerText.match(/Lap\s+(\d+)/)?.[1] ?? null,
      };
    };

    const bodyText = (document.body?.innerText || "").slice(0, 500);
    return {
      url: location.href,
      title: document.title,
      mapBox: box(map),
      speedBox: box(speed),
      speedPath: countSpeedPathPoints(),
      hasMapLibre: !!document.querySelector(".maplibregl-canvas"),
      hasLeaflet: !!document.querySelector(".leaflet-container"),
      errorHints: /could not load|sign in|missing|error/i.test(bodyText)
        ? bodyText.slice(0, 200)
        : null,
    };
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

const results = {};

for (const vp of viewports) {
  const context = await browser.newContext(
    vp.device
      ? { ...vp.device, viewport: { width: vp.width, height: vp.height } }
      : { viewport: { width: vp.width, height: vp.height } },
  );
  const page = await context.newPage();
  const url = `${baseUrl}/sessions/${sessionId}`;
  console.log(`Navigating ${vp.name}: ${url}`);
  const resp = await page.goto(url, {
    waitUntil: "networkidle",
    timeout: 90000,
  });
  console.log(`  status ${resp?.status()}`);
  await page.waitForTimeout(3000);

  // Guest / auth gates
  const guest = page.getByRole("button", { name: /continue as guest|browse/i });
  if (await guest.isVisible().catch(() => false)) {
    await guest.click();
    await page.waitForTimeout(2000);
  }

  const metrics = await measure(page);
  const shot = path.join(
    outDir,
    `prod-map-speed-${label}-${vp.name}.png`,
  );
  await page.screenshot({ path: shot, fullPage: true });
  metrics.screenshot = shot;
  results[vp.name] = metrics;
  console.log(JSON.stringify({ viewport: vp.name, ...metrics }, null, 2));
  await context.close();
}

await browser.close();

const summaryPath = path.join(outDir, `prod-map-speed-${label}.json`);
fs.writeFileSync(summaryPath, JSON.stringify(results, null, 2));
console.log(`Wrote ${summaryPath}`);
