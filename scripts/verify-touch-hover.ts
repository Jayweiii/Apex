/**
 * iOS "tap twice" guard: hover-only UI must not run on touch.
 *
 * iOS Safari fires synthetic mouse events on every tap; if the DOM changes in
 * response (a Recharts tooltip / active dot hiding as the "mouse" leaves a
 * chart), iOS treats the tap as hover and swallows its click. So chart
 * tooltips, active dots and hover previews are mouse-only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const root = resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

for (const file of [
  "src/components/GChart.tsx",
  "src/components/SpeedChart.tsx",
  "src/components/ChannelChart.tsx",
  "src/components/LapCompare.tsx",
]) {
  const src = read(file);
  const tooltips = src.match(/<Tooltip\b/g)?.length ?? 0;
  const gated = src.match(/\{finePointer \? \(\s*<Tooltip\b/g)?.length ?? 0;
  assert(tooltips === gated, `${file}: every <Tooltip> is fine-pointer only (${gated}/${tooltips})`);
  const lines = src.match(/<(Line|Area)\b/g)?.length ?? 0;
  const dots = src.match(/activeDot=\{finePointer \? undefined : false\}/g)?.length ?? 0;
  assert(lines === dots, `${file}: every Line/Area hides activeDot on touch (${dots}/${lines})`);
  assert(!/if \(\(event\.buttons \?\? 0\) === 0\) driveHover/.test(src), `${file}: hover cursor is mouse-only`);
}

const compare = read("src/components/LapCompare.tsx");
assert(!compare.includes("onMouseMove={onChartMouseMove}"), "compare chart hover preview is mouse-only");
assert(read("src/components/HoverCursor.tsx").includes('event.pointerType !== "mouse"'), "plot hover move is mouse-only");
assert(read("src/components/LeafletTrackMap.tsx").includes("if (!hasFinePointer()) return;"), "Leaflet hover preview mouse-only");
assert(read("src/components/ChaseTrackMap.tsx").includes("if (!hasFinePointer()) return;"), "POV map hover preview mouse-only");

console.log(JSON.stringify({ ok: true, touchHover: "off" }));
