# Video ↔ GPS sync (self-serve)

Attach GoPro / iPhone MP4s (or YouTube) to an existing session and align them to UTC GPS without help from the uploader.

## Attach

On the session page **Videos** card:

1. **Attach MP4** — one or more local files. Stored in IndexedDB unless R2/object storage is configured.
2. **Add YouTube** — paste a URL as before.

On attach, the browser reads:

- `moov/mvhd` `creation_time` (UTC via Mac epoch)
- QuickTime `com.apple.quicktime.creationdate` (often local offset on iPhone re-encodes)

When the session has a UTC `started_at` (e.g. Dragy VBO), offset is auto-suggested:

`offsetSec ≈ (videoStartedAtMs − sessionStartedAtMs) / 1000`

**Do not** use GoPro GPS9 `sample.date` / `daysSince2000` for this — that clock has been observed wrong vs the real record day. Same-file GPMF still uses video time ≡ GPS `cts` (offset 0).

## Manual sync (lap page)

Open a lap with the video attached. Uncheck **Follow scrub** so video and chart move independently:

1. Scrub video to a visual cue (SF, start of straight, first brake light).
2. Scrub map/speed chart to the matching GPS moment (or **Snap** to a detected telemetry event).
3. Click **Set lap start / start of straight / first brake**.
4. Fine nudge: ±0.1 s, ±1 frame (`,` / `.` keys).

`offsetSec` is written to `session_videos` (Supabase) so public/friends viewers share the same alignment. Local-only blobs stay in that browser — other viewers see an attach prompt but still get the saved offset once they attach their copy.

## Dual-session compare

Side-by-side compare locksteps two sessions by **shared lap-relative progress**. Each side’s `offsetSec` maps progress `0` (lap start) to the correct video time, so onboard clips stay aligned with map + speed charts.

## Audio sync

Optional later; not implemented yet.
