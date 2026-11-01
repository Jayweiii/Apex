# Apex UI rules

Follow these rules for every control in Apex (web + mobile). They combine
[Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
patterns with [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/) semantics so
Cursor agents and Muse review the same contract.

## Control types (one visual style each)

| Intent | Pattern | Semantics | Visual |
| --- | --- | --- | --- |
| Do something (save, play, delete) | **Action button** | `<button>` | `.apex-btn` / `.apex-btn--primary` / `--danger` / `--accent` |
| Choose one of a small set of modes | **Segmented control** | `role="group"` + `aria-pressed` on each option | `.apex-segment` |
| Switch between full views | **Tabs** | `role="tablist"` / `role="tab"` / `aria-selected` | Existing tab buttons (Account, Tracks) |
| Expand / collapse adjacent content | **Disclosure** | `aria-expanded` + chevron; optional `aria-controls` | `.apex-disclosure` |
| On/off binary setting that is not a mode | **Toggle** (`aria-pressed`) | Prefer segmented when both states are named (mph/km/h) | `.apex-btn` with `--pressed` only when a true toggle is required |

Do **not** reuse a primary action button look for expanders, mode switches, or
tabs. Do **not** use a disclosure look for destructive or primary actions.

## Mode toggles → segmented controls

Use a segmented control (not a single cycling button) for:

- Speed units: **mph | km/h**
- Basemap: **Street | Satellite**
- Map camera: **Overview | POV**
- Chart axis / similar two–three option modes: **Time | Distance**, etc.

Place the control **next to the content it affects** (map chrome for basemap /
POV; chart header for axis; site header or Drive HUD for units).

## Disclosure rows

Expanders (Sync video, Trim panel, Edit details, tools drawers):

1. Use `.apex-disclosure` (or equivalent row) with a trailing chevron.
2. Set `aria-expanded={open}` and, when the panel has an id, `aria-controls`.
3. Keep the trigger visually secondary — not `.apex-btn--primary`.
4. Show compact status meta on the closed row when useful (offset, unsynced).

## Tap targets & touch

- Minimum hit area **44×44 pt** (≈ `min-h-11` / `min-w-11`, or padding that
  reaches 44px). Shared `.apex-btn` defaults to ≥ 40px; bump to 44px on
  primary mobile playback and segmented options.
- `touch-action: manipulation` on all clickables (site-wide in `globals.css`).
- Small inline links / icon buttons: add `.apex-hit` (invisible 44×44 hit
  area, no layout change) — or `.apex-hit--y` when controls sit side by side
  so hit areas never overlap. `a.apex-eyebrow` gets it automatically. Not on
  `truncate`/`overflow-hidden` elements (the overflow clips it); use padding.
- Scrubbers (`input[type=range]`) are 44px tall site-wide.
- Provide an immediate `:active` pressed state; do not rely on hover alone.

## Hover

- Hover styles only under `@media (hover: hover)` (prefer also
  `(pointer: fine)`).
- Tailwind `hover:` is remapped via `@custom-variant hover` nesting
  `media → &:hover → @slot` in `globals.css` so iOS sticky `:hover` cannot
  steal the first tap.
- **No layout-shifting transforms** (`scale` / `translate`) on hover; keep
  those on `:active` only.

## Layout & scrolling

- Primary **playback controls** (Play/Pause, scrub, speed) must be reachable
  **without scrolling** on a typical phone viewport when a session/compare is
  open — sticky under video/map or overlaid on the map as coordinated by the
  mobile play-on-map work.
- **No nested scroll panes** (avoid an `overflow-y: auto` region inside the
  page scroller). Prefer one document scroll; expand panels grow the page.
- Controls sit next to what they affect; do not orphan toggles in a distant
  toolbar when the surface they change is on-screen.
- **No layout shift on scroll appearance:** `html` uses `scrollbar-gutter:
  stable`. Map chrome (`.apex-map-chrome`): modes row (Map · Delta), then the
  **view row** (`.apex-map-chrome__view`) — Street|Satellite and
  Overview|POV in a fixed two-column grid that never wraps. Basemap is never
  beside Delta, and no reflow can move one control under the other's tap.

## Performance (taps must land first time)

- Playback clocks must **not** set React state every frame. Advance a ref +
  `subscribe`; small live readouts use `useLiveProgress`; commit progress on
  pause / end / scrub. Re-rendering a page at 20 Hz starved taps on phones.
- Heavy charts (`SpeedChart`, `GChart`, `StackedLapTelemetry` …) are `memo`;
  pass stable callbacks (`useStableCallback`) so parents don't redraw them.
- Never render hundreds of Recharts children (`<Cell>`) that change per
  frame — draw the moving marker as a positioned overlay.

## CSS layers

`globals.css` puts element defaults in `@layer base` and `.apex-*` controls
in `@layer components`, so Tailwind utilities on the element win (e.g.
`md:hidden` on an `.apex-btn`). Leaflet / marker overrides stay unlayered so
they beat Leaflet's own stylesheet.

## Spacing & typography tokens

Prefer shared tokens over one-off magic numbers:

- Color / brand: `--background`, `--foreground`, `--panel`, `--accent`
- Type: `.apex-eyebrow`, uppercase `tracking-[0.16em]`–`[0.2em]` chrome labels,
  `text-sm` body, `font-mono` for clocks / offsets
- Space: page shell `.apex-page` gaps (`1.5rem` → `1.75rem` at `sm`); control
  clusters use `gap-1.5` / `gap-2`
- Radius: controls `0.5rem` (`.apex-btn`); panels `0.75rem`–`1rem`

## Checklist before shipping UI

1. Correct control type for the intent (table above)?
2. 44×44 tap targets on mobile?
3. Hover gated; `:active` present; `touch-action: manipulation`?
4. Expanders use disclosure + `aria-expanded` + chevron?
5. Mode switches use segmented controls beside their surface?
6. Playback reachable without scroll on phone?
7. No nested scrollers; spacing/type from tokens?
8. Map chrome stable (scrollbar-gutter + fixed view row, Basemap not beside Delta)?
9. No per-frame React state during playback; heavy charts memoized?

## Related

- `src/app/globals.css` — shared `.apex-*` styles and touch/hover contract
- Mobile PR batch: single-tap, play-on-map, POV routes, Sync video disclosure,
  e2e CI
