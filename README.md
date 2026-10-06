# Apex

Track lap-time app: sign in, upload a telemetry CSV, review laps, see a GPS trace, and compare two laps.

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

Until those keys exist, the app runs in this browser only. Sessions stay in local storage on this computer, and **Load sample session** shows three laps, a GPS trace, and a lap comparison. Signing in starts working after `.env.local` is set and the dev server is restarted.

## CSV format

Header row required. Column names are matched case-insensitively.

| Role | Accepted names |
| --- | --- |
| Time | `time`, `timestamp`, `elapsed`, `session_time` |
| Speed | `speed`, `speed_kph`, `speed_mph`, `velocity` |
| Lap (optional) | `lap`, `lap_number` |
| Latitude (optional) | `lat`, `latitude`, `gps_lat` |
| Longitude (optional) | `lon`, `lng`, `longitude`, `gps_lon` |

If `lap` is missing, Apex starts a new lap when time or distance resets. Speed is stored as km/h (`mph` columns are converted). Latitude and longitude draw the driven line and let two laps be overlaid. A sample file is at `public/sample-telemetry.csv`.
