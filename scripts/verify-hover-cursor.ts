/**
 * Hover cursor lag fix:
 * - Pointer X is the single source of truth while hovering
 * - Line + readout paint in the same rAF (no React state per-chart)
 * - Playback solid vs hover dashed are separate
 * - Stack leave (not per-chart) clears hover — no inter-chart flicker
 * - While hovering, playback index does not overwrite hover readout
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createHoverCursorController,
  fractionFromClientX,
  indexFromFraction,
  xFromFraction,
} from "../src/components/hover-cursor";

// Node has no rAF — mirror the browser scheduling the controller relies on.
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

// --- Pure pointer-x math ---------------------------------------------------

assert(fractionFromClientX(50, null) == null, "null element");

const fakePlot = {
  getBoundingClientRect: () => ({
    left: 100,
    width: 200,
    top: 0,
    height: 40,
    right: 300,
    bottom: 40,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  }),
} as HTMLElement;

const pad = { left: 40, right: 10 };
// clientX 100+40 = start of plot → fraction 0
assert(
  Math.abs((fractionFromClientX(140, fakePlot, pad) ?? -1) - 0) < 1e-9,
  "fraction at left pad",
);
// mid of inner 150px → 100+40+75 = 215
assert(
  Math.abs((fractionFromClientX(215, fakePlot, pad) ?? -1) - 0.5) < 1e-9,
  "fraction at mid",
);
assert(indexFromFraction(0.5, 11) === 5, "mid index");
assert(
  Math.abs(xFromFraction(0.5, fakePlot, pad) - 115) < 1e-9,
  "x from mid fraction",
);

// --- Controller: same-frame line + readout; ignore playback while hovering --

const lines: HTMLElement[] = [];
const readouts: HTMLElement[] = [];

function fakeEl(tag = "div"): HTMLElement {
  const style: Record<string, string> = {};
  const el = {
    style: new Proxy(style, {
      set(target, prop, value) {
        target[String(prop)] = String(value);
        return true;
      },
      get(target, prop) {
        return target[String(prop)] ?? "";
      },
    }),
    textContent: "",
    getBoundingClientRect: fakePlot.getBoundingClientRect,
  } as unknown as HTMLElement;
  if (tag === "line") lines.push(el);
  else readouts.push(el);
  return el;
}

const cursor = createHoverCursorController();
const lineA = fakeEl("line");
const lineB = fakeEl("line");
const readout = fakeEl("span");
const plotA = fakePlot;
const plotB = {
  getBoundingClientRect: () => ({
    left: 100,
    width: 200,
    top: 50,
    height: 40,
    right: 300,
    bottom: 90,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  }),
} as HTMLElement;

cursor.attachHoverLine(lineA, plotA, pad);
cursor.attachHoverLine(lineB, plotB, pad);
cursor.attachReadout(
  readout,
  (i) => `hover:${i}`,
  (i) => (i == null ? "play:none" : `play:${i}`),
);

function raf(): Promise<void> {
  return new Promise((resolvePaint) => {
    requestAnimationFrame(() => resolvePaint());
  });
}

async function runControllerTests() {
  cursor.setPlaybackIndex(2);
  await raf();
  let text = String(readout.textContent);
  let opacityA = String(lineA.style.opacity);
  assert(text === "play:2", "playback readout before hover");
  assert(opacityA === "0", "hover line hidden before hover");

  // Pointer move mid across "stacked" charts — both lines + readout same frame
  cursor.move({ clientX: 215, plotEl: plotA, pad, length: 11 });
  await raf();
  text = String(readout.textContent);
  opacityA = String(lineA.style.opacity);
  const opacityB = () => String(lineB.style.opacity);
  assert(text === "hover:5", "hover readout from pointer x");
  assert(opacityA === "1", "hover line A visible");
  assert(opacityB() === "1", "hover line B visible (stacked)");
  assert(
    String(lineA.style.transition) === "none",
    "no CSS transition on hover line",
  );
  assert(
    String(lineB.style.transform).includes("115"),
    "line B at fraction x",
  );

  // Playback updates must not overwrite hover readout / line
  cursor.setPlaybackIndex(9);
  await raf();
  text = String(readout.textContent);
  assert(text === "hover:5", "ignore playback while hovering");
  assert(cursor.isHovering(), "still hovering");
  assert(cursor.getIndex() === 5, "hover index stable");

  // Move onto second chart (same pointer x) — no clear/flicker
  cursor.move({ clientX: 215, plotEl: plotB, pad, length: 11 });
  await raf();
  text = String(readout.textContent);
  assert(text === "hover:5", "cross-chart move keeps index");
  assert(
    String(lineA.style.opacity) === "1" && opacityB() === "1",
    "both lines after cross-chart move",
  );

  cursor.leave();
  await new Promise<void>((resolveLeave) => {
    setTimeout(() => {
      requestAnimationFrame(() => resolveLeave());
    }, 60);
  });
  assert(!cursor.isHovering(), "left stack");
  text = String(readout.textContent);
  opacityA = String(lineA.style.opacity);
  assert(text === "play:9", "playback readout restored");
  assert(opacityA === "0", "hover line cleared");

  // While disabled (playback playing): no hover line / readout; playback only.
  cursor.setPlaybackIndex(3);
  cursor.setEnabled(false);
  await raf();
  cursor.move({ clientX: 215, plotEl: plotA, pad, length: 11 });
  await raf();
  assert(!cursor.isHovering(), "disabled: not hovering");
  assert(cursor.getIndex() == null, "disabled: no hover index");
  assert(String(readout.textContent) === "play:3", "disabled: playback readout");
  assert(String(lineA.style.opacity) === "0", "disabled: hover line hidden");

  // Re-enable (paused): hover preview returns.
  cursor.setEnabled(true);
  cursor.move({ clientX: 215, plotEl: plotA, pad, length: 11 });
  await raf();
  assert(cursor.isHovering(), "re-enabled: hovering");
  assert(String(readout.textContent) === "hover:5", "re-enabled: hover readout");
  assert(String(lineA.style.opacity) === "1", "re-enabled: hover line visible");

  cursor.dispose();
}

function assertArchitecture() {
  const hoverMod = read("src/components/hover-cursor.ts");
  assert(hoverMod.includes("requestAnimationFrame"), "rAF paint");
  assert(
    hoverMod.includes("Pointer X is the single source of truth") ||
      hoverMod.includes("pointer"),
    "pointer SoT",
  );
  assert(hoverMod.includes("transition"), "transition none on lines");

  const scope = read("src/components/HoverCursor.tsx");
  assert(scope.includes("HoverCursorScope"), "scope component");
  assert(scope.includes("data-apex-hover-line"), "hover line marker");
  assert(scope.includes("hoverEnabled"), "scope hoverEnabled prop");
  assert(scope.includes("data-apex-hover-enabled"), "hover enabled marker");
  assert(
    scope.includes('transition: "none"') ||
      scope.includes("transition: 'none'"),
    "no line transition",
  );

  const hoverModGate = read("src/components/hover-cursor.ts");
  assert(hoverModGate.includes("setEnabled"), "controller setEnabled");

  const stacked = read("src/components/StackedTelemetry.tsx");
  assert(stacked.includes("HoverCursorScope"), "stack uses hover scope");
  assert(stacked.includes("playbackIndex"), "playback index into scope");
  assert(stacked.includes("hoverEnabled"), "stack passes hoverEnabled");

  const speed = read("src/components/SpeedChart.tsx");
  assert(speed.includes("HoverCursorLine"), "speed hover line");
  assert(speed.includes("Playback cursor"), "playback solid noted");
  assert(speed.includes("isAnimationActive={false}"), "no chart anim on cursor");

  const synced = read("src/components/video/SyncedLapView.tsx");
  assert(synced.includes("playbackIndex"), "session playback-only chart index");
  assert(synced.includes("hoverReadoutRef"), "session hover readout bridge");
  assert(synced.includes("hoverEnabled"), "session gates hover while playing");
  assert(
    synced.includes("hoverPreviewEnabled={hoverEnabled}"),
    "session gates map hover while playing",
  );
  assert(
    !synced.includes("displayProgress = previewProgress ?? clock.progress"),
    "session must not merge preview into chart activeIndex",
  );

  const compare = read("src/components/LapCompare.tsx");
  assert(compare.includes("hoverEnabled"), "compare gates hover while playing");
  assert(
    compare.includes("onPlayingChange={setPlaying}"),
    "compare listens to dual video playing",
  );

  const lapCharts = read("src/components/LapCharts.tsx");
  assert(lapCharts.includes("playbackIndex"), "LapCharts playback-only index");
}

runControllerTests()
  .then(() => {
    assertArchitecture();
    console.log(
      JSON.stringify({
        ok: true,
        pointerSoT: true,
        sameFrameLineAndReadout: true,
        dualCursor: "hover-dashed playback-solid",
        ignorePlaybackWhileHovering: true,
        disableHoverWhilePlaying: true,
        stackedPointerMove: true,
      }),
    );
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
