# Video ↔ GPS sync (YouTube-only)

Attach onboard clips to a session by **YouTube URL** (or the channel catalog) and align them to UTC GPS. Local GoPro MP4/LRV files are **telemetry sources only** — never stored as video; upload the clip to YouTube and paste the link.

## Attach

On the session page **Videos** card:

1. Paste a YouTube URL (or attach a catalog suggestion).
2. Bind to a lap, or leave **Whole session** for one clip covering many laps.
3. **Bulk paste** several URLs — assigned to laps in order.
4. Lap chips show which laps already have a dedicated (`yt`) or session-level (`sess`) video.
5. Nudge offset ±0.1s or **Set start line here** on the session card; fine sync stays on the selected lap panel.

Offset is saved in `session_videos.offset_sec` (migration `20261019_lap_videos.sql` / view `lap_videos`) so public/friends share the same sync.

## Auto-suggest

When the video and session both have absolute clocks (session `started_at` from GPS / logger UTC; optional video metadata), offset is suggested:

`offsetSec ≈ (videoStartedAtMs − sessionStartedAtMs) / 1000`

For GoPro sessions, `sessionStartedAtMs` prefers **GPS-derived** wall-clock when plausible (≥2015, not far-future), then MP4 `creation_time`, then Sync-panel override. Same-file GPMF GPS still uses video time ≡ GPS `cts` for the telemetry timeline; the YouTube onboard is aligned via `offsetSec`.

## Manual sync (lap page)

Open a lap with the YouTube video attached. Uncheck **Follow scrub** so video and chart move independently:

1. Scrub video to a visual cue (SF, start of straight, first brake).
2. Scrub map/speed chart to the matching GPS moment (or **Snap** to a detected telemetry event).
3. Click **Set lap start / start of straight / first brake**.
4. Fine nudge: ±0.1 s, ±1 frame (`,` / `.` keys).

## Dual-session compare

Side-by-side compare locksteps **two YouTube IFrame players** by shared lap-relative progress (0..1). Each side’s `offsetSec` maps progress `0` (lap start) to the correct video time. Shared play/pause/scrub drives both; map + speed charts follow. (YouTube iframe playback-rate APIs are limited — lockstep uses seek.)

## Audio sync

Optional later; not implemented yet.
