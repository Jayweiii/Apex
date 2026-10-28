# Contributing to Apex

## UI contract

Before changing controls, layouts, or interaction patterns, read and follow
**[docs/UI_RULES.md](docs/UI_RULES.md)**.

That document is the shared source of truth for Cursor agents and Muse reviews:

- One visual style per control type (actions vs segments vs tabs vs disclosures)
- Segmented controls for mode toggles (mph/km/h, Street/Satellite, Overview/POV)
- Disclosure rows with chevron + `aria-expanded` for expand/collapse
- Min 44×44pt tap targets; hover only under `@media (hover: hover)`; `:active`
  pressed feedback; `touch-action: manipulation`
- Controls next to the surface they affect; no nested scroll panes
- Primary playback reachable without scrolling on phone viewports

## Agents

Also see [AGENTS.md](AGENTS.md) for Next.js version notes and the same UI rules
pointer.

## Pull requests

Prefer a PR over pushing to `main`. For mutual review with Muse, follow the
collaboration process on the Apex roadmap issue when applicable.
