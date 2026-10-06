# Apex

Track lap-time app: upload TrackAddict CSV or GoPro MP4 telemetry, review laps, sync onboard video, compare corners, and share deep links. Public datasets are attributed; synthetic demos and your uploads are labeled separately.

## Setup

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/schema.sql`.
3. In **Authentication**, enable Email. For local testing you can turn off “Confirm email”.
4. Copy `.env.example` to `.env.local` and fill in **Project URL** and **anon public** key from **Project Settings → API**.
5. Optional — Cloudflare R2 for durable raw/video storage:

```bash
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=…
R2_PUBLIC_BASE_URL=   # optional CDN/public base for video URLs
```

When those are unset, Apex uses the local filesystem fallback under `.data/uploads/` (server) and IndexedDB (browser) so uploads still work in development.

6. Install Node.js if needed, then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **Object storage:** Presigned R2 uploads (S3 API) with local fallback; CSV originals can be re-processed after parser improvements
- **GoPro:** Client-side GPMF extract (`gpmf-extract` + `gopro-telemetry`) for GPS5/GPS9 + accelerometer; multi-chapter MP4 selection; clear error when GPS is missing
- **Video sync:** Optional onboard MP4 synced to chart/map scrubbing
- **Theoretical best:** Best micro-sectors vs actual best lap
- **Corners:** Brake / min / exit and time delta vs reference
- **Drivers & cars:** Driver profiles, class, tags (e.g. “205 tires”)
- **Leaderboards:** Per track / class / driver from local uploads
- **Share links:** Session, lap, and compare deep links (`/share/[sessionId]`)
- **Weather & tires:** Notes shown on session, lap, and compare views

## Data kinds

| Kind | Meaning |
| --- | --- |
| **Public data** | Real telemetry redistributed under a clear open license |
| **Synthetic demo** | Generated Laguna Seca–style laps for UI exploration |
| **Your upload** | CSV/GoPro you imported |

### Public datasets

| Session | Track | Source | License |
| --- | --- | --- | --- |
| Spreewaldring — TrackAddict log | Spreewaldring Training Center | [thomasjungblut/trackaddict-cli](https://github.com/thomasjungblut/trackaddict-cli) `example/STC_log.csv` | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |

## Scripts

```bash
npm test
npm run test:parse
npm run test:storage
npm run build:datasets
npm run build
```
