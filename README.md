# Apex

Track lap-time app: upload a telemetry CSV, review laps, see a GPS trace, and compare two laps. Public datasets are attributed; synthetic demos and your uploads are labeled separately.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/schema.sql`.
3. In **Authentication**, enable Email. For local testing you can turn off “Confirm email”.
4. Copy `.env.example` to `.env.local` and fill in **Project URL** and **anon public** key from **Project Settings → API**.
5. Install Node.js if needed, then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Until those keys exist, the app runs in this browser only. Sessions stay in local storage on this computer. Signing in starts working after `.env.local` is set and the dev server is restarted.

## Data kinds

| Kind | Meaning |
| --- | --- |
| **Public data** | Real telemetry redistributed under a clear open license (see attribution on the session) |
| **Synthetic demo** | Generated Laguna Seca–style laps for UI exploration |
| **Your upload** | CSV you imported; kept in this browser (or your account when signed in) |

### Public datasets

| Session | Track | Source | License |
| --- | --- | --- | --- |
| Spreewaldring — TrackAddict log | Spreewaldring Training Center | [thomasjungblut/trackaddict-cli](https://github.com/thomasjungblut/trackaddict-cli) `example/STC_log.csv` | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |

Source CSV and license copy live under `third_party/`. Rebuild the seed with:

```bash
npm run build:datasets
```

RaceRender’s developer sample (`RRData.csv`) is linked from their docs but is **not** redistributed here (no clear redistribution license on that page). No redistributable Thunderhill East GPS log was found; the track is listed so you can upload your own sessions.

## CSV format

Header row required. Column names are matched case-insensitively. Lines starting with `#` (TrackAddict / RaceRender metadata) are skipped.

| Role | Accepted names |
| --- | --- |
| Time | `time`, `timestamp`, `elapsed`, `session_time` |
| Speed | `speed`, `speed_kph`, `speed_mph`, `velocity` |
| Lap (optional) | `lap`, `lap_number` |
| Latitude (optional) | `lat`, `latitude`, `gps_lat` |
| Longitude (optional) | `lon`, `lng`, `longitude`, `gps_lon` |

If `lap` is missing, Apex starts a new lap when time or distance resets. Speed is stored as km/h (`mph` / `Speed (MPH)` columns are converted). Latitude and longitude draw the driven line and let two laps be overlaid. A synthetic demo file is at `public/sample-telemetry.csv`.

## Scripts

```bash
npm run test:parse
THUNDERHILL_CSV=/path/to/log.csv npm run test:parse
npm run build:datasets
npm run build
```
