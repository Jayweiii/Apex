/**
 * Session Video sync control is a disclosure, not a primary action button.
 * Compact label + chevron, aria-expanded, collapsed offset readout, gated hover.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const synced = readFileSync(
  resolve(root, "src/components/video/SyncedLapView.tsx"),
  "utf8",
);
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

assert(synced.includes('data-testid="toolbar-sync"'), "toolbar-sync id kept");
assert(synced.includes('className="apex-disclosure"'), "disclosure class");
assert(synced.includes("aria-expanded={syncOpen}"), "aria-expanded");
assert(synced.includes('aria-controls="video-sync-panel"'), "aria-controls");
assert(synced.includes("Video sync"), "Video sync label");
assert(synced.includes("apex-disclosure__chevron"), "chevron");
assert(synced.includes("syncOffsetMeta"), "collapsed offset meta");
assert(synced.includes("offset ${sign}"), "offset readout when synced");
assert(synced.includes('id="video-sync-panel"'), "panel id for aria-controls");
assert(
  !/data-testid="toolbar-sync"[\s\S]*?apex-btn/.test(synced),
  "toolbar-sync is not an apex-btn primary action",
);
assert(
  !/data-testid="toolbar-sync"[\s\S]*?aria-pressed/.test(synced),
  "toolbar-sync uses aria-expanded not aria-pressed",
);

assert(css.includes(".apex-disclosure"), "disclosure styles");
assert(css.includes(".apex-disclosure__chevron"), "chevron styles");
assert(
  css.includes('.apex-disclosure[aria-expanded="true"] .apex-disclosure__chevron'),
  "chevron rotates when expanded",
);
assert(css.includes("touch-action: manipulation"), "single-tap friendly");
assert(
  /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.apex-disclosure:hover/.test(
    css,
  ),
  "disclosure hover gated to fine pointer",
);
assert(css.includes(".apex-disclosure:active"), "pressed/active state");
assert(css.includes(".apex-disclosure:focus-visible"), "keyboard focus ring");

const disclosureHover = css.match(
  /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.apex-disclosure:hover[\s\S]*?\n\}/,
);
assert(disclosureHover, "disclosure hover block present");
assert(
  !/transform\s*:\s*[^;]*(scale|translate)/.test(disclosureHover![0]),
  "no layout-shifting transform on disclosure hover",
);

console.log(
  JSON.stringify({
    ok: true,
    control: "apex-disclosure",
    label: "Video sync",
    a11y: ["aria-expanded", "aria-controls", "focus-visible"],
    collapsedOffset: true,
  }),
);
