/**
 * Static contract: iPhone first-tap must fire click (no sticky :hover).
 * - Tailwind hover remapped via nested @custom-variant (media → &:hover → @slot)
 * - Shared apex-* hover behind (hover:hover) and (pointer:fine)
 * - touch-action: manipulation on clickables
 * - No layout-shifting transforms on :hover (scale / translate stay on :active)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

assert(css.includes("@custom-variant hover"), "custom hover variant");
assert(
  css.includes("@media (hover: hover) and (pointer: fine)"),
  "fine-pointer hover media",
);
assert(
  /@custom-variant hover\s*\{[\s\S]*?@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?&:hover[\s\S]*?@slot/.test(
    css,
  ),
  "custom-variant nests media → &:hover → @slot (not @media …:hover shorthand)",
);
assert(
  !/^@custom-variant hover \(/m.test(css),
  "no broken shorthand that emits invalid @media …:hover",
);

assert(css.includes("touch-action: manipulation"), "touch-action on clickables");
assert(
  /button:not\(:disabled\)[\s\S]*touch-action:\s*manipulation/.test(css),
  "buttons get touch-action:manipulation",
);
assert(css.includes(".apex-btn:active"), "pressed/active styles kept");
assert(css.includes(".apex-nav-link:active"), "nav pressed styles kept");

assert(
  /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*a\.apex-eyebrow:hover/.test(
    css,
  ),
  "eyebrow hover gated by fine pointer",
);

const hoverBlocks = [
  ...css.matchAll(
    /@media \(hover: hover\) and \(pointer: fine\)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
  ),
];
assert(hoverBlocks.length >= 8, "expected multiple gated hover blocks");
for (const [, body] of hoverBlocks) {
  assert(
    !/transform\s*:\s*[^;]*(scale|translate)/.test(body),
    "no transform scale/translate inside hover media (layout shift)",
  );
}

console.log(
  JSON.stringify({
    ok: true,
    hoverVariant: "nested media+&:hover+@slot",
    touchAction: "manipulation",
    layoutShiftOnHover: false,
    activeStyles: true,
  }),
);
