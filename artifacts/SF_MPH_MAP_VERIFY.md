# Prod verify — SF editor / map size / mph

Production: https://apex-ashy-beta.vercel.app  
Session: `1aa2fb88-8204-4abb-b745-520ea99819dd`  
Prod deploy SHA: `1e768ed0ba48f2e46eed1faf285e025b988ce4d5` (includes feature `6185d6e`)  
Vercel: `dpl_EfMZohrAFC962QV2bzph2zzrBhnM` READY → apex-ashy-beta.vercel.app

## Root cause (black map)
React rewrote `className` on the Leaflet mount node when `sfEditing` toggled, wiping `leaflet-container` and blanking tiles. Fix: stable inner mount (`h-full w-full`); dynamic chrome on wrapper.

## Map height CSS
`MAP_EMBED_HEIGHT_CLASS = "h-[380px] min-h-[360px] sm:h-[min(60vh,600px)] sm:min-h-[550px]"`

## Units toggle
Header `SpeedUnitToggle` (`data-apex-speed-unit-toggle`), default `mph`, localStorage `apex.speed-unit`.

## Playwright measurements
| Viewport | Map height | Tiles | Handles | Peak / unit | Toggle |
|----------|------------|-------|---------|-------------|--------|
| 1440×900 | **550px** | 9 | 2 | Peak 35 mph | mph |
| 390×844 | **380px** | 4 | 2 | Peak 78 mph | mph |

SF editor open: tiles + A/B handles + Save/Cancel; `leaflet-container` retained.

## Screenshots
- `/opt/cursor/artifacts/prod-sf-editor-open-desktop-1440x900.png`
- `/opt/cursor/artifacts/prod-sf-editor-open-iphone-390x844.png`
- `/opt/cursor/artifacts/prod-sf-mph-desktop-1440x900-overview.png`
- `/opt/cursor/artifacts/prod-sf-mph-iphone-390x844-overview.png`
- `/opt/cursor/artifacts/prod-sf-mph-map-verify.json`
