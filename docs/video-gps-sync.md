# Video ↔ GPS sync (YouTube-only)

Attach onboard clips to a session by **YouTube URL** (or the channel catalog) and align them to GPS lap starts. Local GoPro MP4/LRV files are **telemetry sources only** — never stored as video; upload the clip to YouTube and paste the link.

## Guided sync (session page, selected lap)

Each selected lap shows a compact **Sync this lap** stepper:

1. **Paste YouTube link** — attach or replace the onboard for that lap.
2. **Find the start line** — pause on the exact SF crossing, click **Mark start line here**. Frame-step and ±0.1s nudge sit beside the control; **Auto-guess** estimates from clip length vs lap time when duration is known.
3. **Check the sync** — **Play map + video** (enabled after mark), watch the live readout (e.g. “Video starts 3.4s before the lap”) and the **Synced** / **Not synced** badge.
4. **Saved** — offset writes automatically; a brief **Saved** confirmation flashes. **Undo** / **Reset** are available.

Until you mark, YouTube stays free so you can scrub without dragging the map. After **Synced**, map/charts and video lockstep (two-way).

Lap list badges show **Synced** or **Not synced** per dedicated clip. Bulk paste / catalog attach lives under **Bulk YouTube / catalog**.

Offset is saved in `session_videos.offset_sec` so public/friends share the same sync.

## How syncing works

GPS lap `t=0` is the start/finish crossing. Marking sets `offsetSec` so that video time at lap start equals the paused frame.

## Dual-session compare

Side-by-side compare locksteps YouTube players by shared lap-relative progress (0..1). Each side’s saved `offsetSec` maps progress `0` to the correct video time.

## Audio sync

Optional later; not implemented yet.
