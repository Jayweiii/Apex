# GoPro import guide

Apex prefers **GoPro GPS** over phone CSV for speed, laps, and the track map (Dragy-style). Telemetry is parsed **in the browser** so large MP4s are not uploaded wholesale.

## Supported inputs

| Source | Format | Notes |
|--------|--------|--------|
| GoPro Hero5+ media | `.mp4`, `.lrv`, `.mov` | GPMF extracted client-side (`gpmf-extract` block-reads the File — up to ~2GB without loading the whole video). **Always `await` gopro-telemetry** (v1.2 returns a Promise). Uses **GPS9** when present, else **GPS5**. Drops `fix=0` / lat·lon=0 samples. DOP + fix read from GPS9 `value[7]`/`value[8]`. ACCL/GYRO when present. Session UTC clock: **prefer GPS-derived date/time**; fall back to MP4 `creation_time` if GPS is missing or implausible (&lt;2015 or far future); manual override still wins. |
| Quik / Telemetry Overlay | `.gpx`, `.json`, `.csv` | Export GPS track separately; no MP4 required. |
| GPX (any logger) | `.gpx` | Track points with time + speed/extensions. |
| VBO (RaceLogic / Dragy) | `.vbo` | Dragy DRG71: `sats time lat long velocity heading height`; time = UTC `hhmmss.sss` + `UTC Date Started`; lat/lon = signed minutes; **positive lon = west**; velocity km/h; sats → GPS quality. |
| Dragy CSV | `.csv` | Autodetects time, lat, lon, speed, heading, altitude columns. |
| Phone / TrackAddict | `.csv` | Still supported; ranked below GoPro / dedicated loggers in compare. |
| Dragy `.dlap` | `.dlap` | **Not supported** — zip with PNG map + encrypted `.group`. Export CSV/GPX/VBO from Dragy instead. |

## How to export from Quik

1. Open the clip in **GoPro Quik**.
2. Export or share the **GPS / telemetry track** (GPX when available).
3. In Apex → Upload, choose the `.gpx` (or `.json` / `.csv` if that is what Quik gives you).
4. Pick the **track** so start/finish can auto-split laps.
5. Optionally paste a **YouTube URL** for onboard sync instead of uploading the MP4.

## How to export with Telemetry Overlay

1. Load the GoPro MP4 in [Telemetry Overlay](https://goprotelemetryextractor.com/) (or similar).
2. Export **GPX**, **JSON**, or **CSV** with latitude, longitude, time, and speed.
3. Upload that file in Apex (check “GoPro Quik / Telemetry Overlay export” if the file is `.csv`).

## MP4 / LRV as telemetry (not video storage)

- **Parse GPMF locally** (metadata track only via File.slice / ~2MB blocks), save laps + GPS quality. The media file is **never uploaded**.
- Onboards are **YouTube-only**: upload the clip to YouTube and paste the link on the session (or at upload time).
- Multi-chapter: select several chapter files together; Apex concatenates by cts.
- Wall-clock for session date / time-of-day sync: **GPS sample.date − cts** when plausible; else MP4 `creation_time` (mvhd / QuickTime); Sync panel can still override manually.
- Local parse cap ~2GB.

## Laps

Laps are auto-detected from the GPS trace using the track’s **start/finish** (centerline first point or track lat/lon). Drive a full lap past S/F outdoors with a 3D lock.

## GPS quality badge

Each GoPro session stores a quality summary (stream, DOP, fix). Compare lists **prefer GoPro** sessions over phone CSV.

## Dragy `.dlap`

Jason’s native Dragy `.dlap` is a zip containing a PNG track map and an encrypted `.group` blob. Apex **cannot** decrypt the lap data. In Dragy: Share / Export → **CSV**, **GPX**, or **VBO**, then upload that file. If you drop a `.dlap` anyway, Apex shows a clear message and may suggest the track name/date from the PNG filename (e.g. `ThunderhillRacewayParkWest_20261017161829.png`).

## Troubleshooting

| Message | What to do |
|---------|------------|
| No GPMF metadata track | Use the **original** GoPro MP4/LRV (YouTube strips GPMF). Or export GPX/JSON. |
| **No GPS in this file** | Short clips / some modes have GPMF but no GPS9/GPS5 stream. Record longer outdoors with GPS on, or export GPX. |
| No usable GPS fix | Leading samples often have `fix=0` and lat/lon 0 — wait for a 3D lock outdoors before recording. |
| Laps could not be detected | Drive a full lap past start/finish, or select the correct track. |
| Could not parse GPMF | Confirm Hero5+ with GPS; try Quik/Telemetry Overlay export instead. |
| `.dlap` / encrypted `.group` | Export CSV, GPX, or VBO from Dragy — do not upload the native `.dlap`. |

Real Hero5+ clips are not required for CI — synthetic GPMF fixtures exercise the parse path (`npm run test:gopro`).
