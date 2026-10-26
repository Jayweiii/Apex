import { chromium, devices } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE_URL || "https://apex-ashy-beta.vercel.app";
const OUT = "/opt/cursor/artifacts";
mkdirSync(OUT, { recursive: true });
const SESSION_A = "340f914a-49f7-4c6e-bccc-33a3fe2de689";
const SESSION_B = "1aa2fb88-8204-4abb-b745-520ea99819dd";

const results = { base: BASE, sha: "84edee6", at: new Date().toISOString(), checks: {} };
function ok(name, pass, detail) {
  results.checks[name] = { pass: Boolean(pass), detail: detail ?? null };
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ headless: true });

async function readClock(page) {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll("[role=group]")];
    const g = groups.find((el) => /Playback|Lap playback/i.test(el.textContent || ""));
    const m = (g?.textContent || "").match(/(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/);
    return m ? Number(m[1]) : null;
  });
}

// --- 1+2+3+7: play rate, gaps, POV, play width ---
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/sessions/${SESSION_A}/compare`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(5000);

  const play = page.getByRole("button", { name: /^Play$/i }).first();
  const speedIdle = await page.locator("[aria-label='Playback speed']").boundingBox();
  const playBox = await play.boundingBox();
  await play.click();
  await page.waitForTimeout(200);
  const pauseBox = await page.getByRole("button", { name: /^Pause$/i }).first().boundingBox();
  const speedPlaying = await page.locator("[aria-label='Playback speed']").boundingBox();
  const speedBefore = speedPlaying;
  // continue playing for rate measure
  const wall0 = Date.now();
  const c0 = await readClock(page);
  const gapSamples = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(500);
    const at = await readClock(page);
    const gaps = await page.locator(".apex-car-marker__gap").allTextContents();
    gapSamples.push({ wallMs: Date.now() - wall0, at, gaps });
  }
  const wall = (Date.now() - wall0) / 1000;
  const c1 = await readClock(page);
  const media = c0 != null && c1 != null ? c1 - c0 : null;
  const rate = media != null && wall > 0 ? media / wall : null;
  ok(
    "play-rate-1x",
    rate != null && rate >= 0.95 && rate <= 1.05,
    `rate=${rate?.toFixed(3)} mediaΔ=${media?.toFixed(2)} wall=${wall.toFixed(2)}`,
  );

  // Gaps should NOT equal -elapsed
  const gapOk = gapSamples.every((s) => {
    if (!s.gaps.length || s.at == null) return false;
    const g = Number(String(s.gaps[0]).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(g) && Math.abs(g + s.at) > 0.35;
  });
  const gapVary = new Set(gapSamples.map((s) => s.gaps[0])).size >= 2;
  ok("gap-not-minus-elapsed", gapOk && gapVary, JSON.stringify(gapSamples.map(s => ({at:s.at,gaps:s.gaps}))));

  // vs reference should change while playing (live gap)
  const vsTexts = [];
  for (let i = 0; i < 3; i++) {
    const t = await page.locator("text=vs reference").locator("..").innerText().catch(() => "");
    vsTexts.push(t.replace(/\s+/g, " ").trim());
    await page.waitForTimeout(800);
  }
  await page.getByRole("button", { name: /^Pause$/i }).first().click().catch(() => {});

  // Delta chart: sample path data non-flat
  const deltaNonFlat = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-apex-compare-chart]")];
    const delta = cards.find((c) => /Delta/i.test(c.textContent || ""));
    if (!delta) return { ok: false, reason: "no delta card" };
    const path = delta.querySelector(".recharts-line-curve, path.recharts-curve");
    if (!path) return { ok: false, reason: "no path" };
    const d = path.getAttribute("d") || "";
    // Extract Y coords roughly
    const nums = [...d.matchAll(/[\s,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const ys = nums.filter((_, i) => i % 2 === 1);
    if (ys.length < 4) return { ok: false, reason: `few ys ${ys.length}`, d: d.slice(0,80) };
    const min = Math.min(...ys), max = Math.max(...ys);
    return { ok: max - min > 2, span: max - min, n: ys.length };
  });
  ok("delta-chart-nonflat", deltaNonFlat.ok, JSON.stringify(deltaNonFlat));

  const playCss = await page.locator("[data-apex-play-toggle]").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { width: parseFloat(cs.width), speedX: document.querySelector("[aria-label='Playback speed']")?.getBoundingClientRect().x };
  });
  ok(
    "play-pause-width-stable",
    // Layout width is fixed (CSS); speed row must not move. BoundingBox can
    // include hover scale(1.04) which is visual-only and must not fail this.
    playCss.width === 96 &&
      speedIdle &&
      speedPlaying &&
      Math.abs(speedIdle.x - speedPlaying.x) <= 0.5,
    `cssW=${playCss.width} speedX=${speedIdle?.x}->${speedPlaying?.x} boxes=${playBox?.width?.toFixed(1)}/${pauseBox?.width?.toFixed(1)}`,
  );

  // POV multi-car solid
  if (await page.getByRole("button", { name: /^POV$/i }).count()) {
    await page.getByRole("button", { name: /^POV$/i }).click();
    await page.waitForTimeout(1500);
  }
  const pov = await page.evaluate(() => {
    const dots = [...document.querySelectorAll(".apex-car-marker__dot")];
    return {
      dots: dots.length,
      ghost: dots.filter((d) => d.className.includes("ghost")).length,
      gaps: [...document.querySelectorAll(".apex-car-marker__gap")].map((e) => e.textContent),
    };
  });
  ok(
    "pov-multi-car",
    pov.dots >= 2 && pov.ghost === 0,
    JSON.stringify(pov),
  );

  // Hover styles on Tracks + speed
  const hover = await page.evaluate(() => {
    const tracks = [...document.querySelectorAll("a")].find((a) => /^Tracks$/i.test(a.textContent || ""));
    const speed = document.querySelector("[aria-label='Playback speed'] button");
    if (!tracks || !speed) return null;
    const idleT = getComputedStyle(tracks).backgroundColor;
    const idleS = getComputedStyle(speed).backgroundColor;
    tracks.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    // force :hover isn't possible; compare pressed vs idle for speed instead
    const pressed = document.querySelector("[aria-label='Playback speed'] button[aria-pressed='true']");
    const unpressed = document.querySelector("[aria-label='Playback speed'] button[aria-pressed='false']");
    return {
      tracksIdle: idleT,
      tracksClass: tracks.className,
      speedIdle: idleS,
      pressedBg: pressed ? getComputedStyle(pressed).backgroundColor : null,
      unpressedBg: unpressed ? getComputedStyle(unpressed).backgroundColor : null,
      distinct: pressed && unpressed
        ? getComputedStyle(pressed).backgroundColor !== getComputedStyle(unpressed).backgroundColor
        : false,
    };
  });
  ok("speed-pressed-distinct", hover?.distinct, JSON.stringify(hover));

  await page.screenshot({ path: resolve(OUT, "reqa-prod-compare-desktop.png"), fullPage: true });
  await page.close();
}

// --- 4: session default ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/sessions/${SESSION_B}/compare`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(5000);
  const selected = await page.locator("select").first().inputValue().catch(() => null);
  const label = await page.locator("select").first().evaluate((el) => el.options[el.selectedIndex]?.text).catch(() => null);
  const comparing = await page.locator("body").innerText().then((t) => t.match(/COMPARING[\s\S]{0,280}/i)?.[0] ?? "");
  ok(
    "compare-default-url-session",
    selected === SESSION_B,
    `selected=${selected} label=${label} comparing=${comparing.slice(0,160).replace(/\n/g," ")}`,
  );
  await page.screenshot({ path: resolve(OUT, "reqa-prod-session-b-default.png"), fullPage: true });
  await page.close();
}

// --- 5: Tracks nav hover via computed styles with force class check ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1000);
  const nav = await page.evaluate(() => {
    const link = [...document.querySelectorAll("a.apex-nav-link")].find((a) =>
      /Tracks/i.test(a.textContent || ""),
    );
    if (!link) return null;
    const idle = {
      bg: getComputedStyle(link).backgroundColor,
      color: getComputedStyle(link).color,
    };
    link.classList.add("force-hover-test");
    // Read stylesheet rule intent: ensure hover rule exists with distinct bg
    const sheets = [...document.styleSheets];
    let hoverRule = null;
    for (const sheet of sheets) {
      let rules;
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && /hover:\s*hover/.test(rule.conditionText || "")) {
          for (const inner of rule.cssRules) {
            if (/\.apex-nav-link:hover/.test(inner.selectorText || "")) {
              hoverRule = inner.cssText;
            }
          }
        }
      }
    }
    return { idle, hoverRule, hasStrongHover: /63 63 70|rgb\(63,\s*63,\s*70\)|scale|translateY/.test(hoverRule || "") };
  });
  ok("tracks-nav-hover-css", nav?.hasStrongHover, JSON.stringify(nav));
  await page.close();
}

// --- 6: iPhone chart height ---
{
  const context = await browser.newContext({ ...devices["iPhone 12"], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sessions/${SESSION_A}/compare`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(4500);
  const plot = page.locator("[data-apex-chart-plot='compare']").first();
  await plot.scrollIntoViewIfNeeded().catch(() => {});
  const box = await plot.boundingBox();
  const surface = await page.locator("[data-apex-chart-plot='compare'] .recharts-surface").first().boundingBox().catch(() => null);
  ok(
    "iphone-plot-height",
    box != null && box.height >= 200,
    `plot=${Math.round(box?.height ?? 0)} surface=${Math.round(surface?.height ?? 0)}`,
  );
  await page.screenshot({ path: resolve(OUT, "reqa-prod-iphone-charts.png"), fullPage: true });
  await context.close();
}

// --- 8+9+10: map scroll, leaderboard, track outline ---
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/tracks/thunderhill-west`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(4000);
  // Wait for cloud GPS outline to replace ellipse/pin fallback
  await page.waitForTimeout(5000);
  const mapInfo = await page.evaluate(() => {
    const paths = [...document.querySelectorAll(".leaflet-overlay-pane path")];
    let best = null;
    for (const poly of paths) {
      const d = poly.getAttribute("d") || "";
      const pts = [...d.matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)|[ML]([\d.]+)\s+([\d.]+)/g)].map((m) => [
        Number(m[1] || m[3]),
        Number(m[2] || m[4]),
      ]);
      if (!best || pts.length > best.n) best = { dLen: d.length, n: pts.length, pts, sample: d.slice(0, 120) };
    }
    if (!best || best.n < 8) return best;
    const pts = best.pts;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const rs = pts.map(([x, y]) => Math.hypot(x - cx, y - cy));
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const variance = rs.reduce((s, r) => s + (r - mean) ** 2, 0) / rs.length;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
    return { n: best.n, cv, mean, dLen: best.dLen, sample: best.sample };
  });
  // Real track should have higher shape irregularity than smooth ellipse (cv typically > 0.08)
  const outlineMeta = await page.locator("[data-apex-track-outline]").first().evaluate((el) => ({
    kind: el.getAttribute("data-apex-track-outline"),
    points: Number(el.getAttribute("data-apex-track-points") || 0),
  })).catch(() => null);
  ok(
    "track-outline-from-gps",
    (outlineMeta?.kind === "gps" && outlineMeta.points >= 40) ||
      (mapInfo != null && mapInfo.n >= 40),
    JSON.stringify({ outlineMeta, mapInfo }),
  );

  // Map should not use touch-none (page scroll)
  const touch = await page.evaluate(() => {
    const el = document.querySelector("[data-apex-map], .leaflet-container")?.closest("div");
    const host = document.querySelector(".leaflet-container")?.parentElement;
    return {
      hostClass: host?.className?.slice(0, 120),
      hasTouchNone: /touch-none/.test(host?.className || ""),
    };
  });
  ok("map-allows-page-scroll", touch && !touch.hasTouchNone, JSON.stringify(touch));

  const lb = page.getByRole("tab", { name: /Leaderboard/i });
  if (await lb.count()) {
    await lb.click();
    await page.waitForTimeout(2500);
  }
  const lbText = await page.locator("body").innerText();
  const times = [...lbText.matchAll(/(\d+):(\d{2})\.(\d{3})/g)].map((m) => m[0]);
  const top = times[0];
  const topMs = top
    ? Number(top.split(":")[0]) * 60000 +
      Number(top.split(":")[1].split(".")[0]) * 1000 +
      Number(top.split(".")[1])
    : null;
  ok(
    "leaderboard-no-inlap",
    topMs != null && topMs >= 45_000 && !/^0:0/.test(top || ""),
    `top=${top} times=${times.slice(0, 6).join(",")}`,
  );
  const ryanTimes = [...lbText.matchAll(/Ryan[^\n]*?(\d+:\d{2}\.\d{3})/gi)].map((m) => m[1]);
  const ryanDup = ryanTimes.filter((t, i, a) => a.indexOf(t) !== i);
  ok("leaderboard-dedupe", ryanDup.length === 0, `ryan=${ryanTimes.join("|")}`);

  await page.screenshot({ path: resolve(OUT, "reqa-prod-track-leaderboard.png"), fullPage: true });
  await page.close();
}

// Session page best
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${BASE}/sessions/${SESSION_A}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForTimeout(3500);
  const text = await page.locator("body").innerText();
  const best = text.match(/best\s+(\d+:\d{2}\.\d{3})/i)?.[1];
  const bestMs = best
    ? Number(best.split(":")[0]) * 60000 +
      Number(best.split(":")[1].split(".")[0]) * 1000 +
      Number(best.split(".")[1])
    : null;
  ok(
    "session-best-valid",
    bestMs != null && bestMs >= 90_000 && bestMs < 120_000,
    `best=${best}`,
  );
  await page.screenshot({ path: resolve(OUT, "reqa-prod-session-best.png"), fullPage: false });
  await page.close();
}

await browser.close();
const failed = Object.values(results.checks).filter((c) => !c.pass).length;
results.failed = failed;
writeFileSync(resolve(OUT, "reqa-prod-verify.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
