# YouTube sync + friends sessions — setup for Jason

## 1. Supabase SQL (required for cloud / friends)

In the Supabase SQL editor, run:

1. Existing base schema if this is a new project: `supabase/schema.sql`
2. Additive migration: `supabase/migrations/20261006_youtube_sync_friends.sql`

That adds `sessions.started_at`, `sessions.session_date`, `laps.start_offset_sec`, `laps.started_at_ms`, table `session_videos`, and RLS so:

- owners insert/update/delete their rows
- any **authenticated** user can **select** sessions, laps, videos, and drivers (friends feed)

## 2. Env vars (Vercel + local)

Already used today:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- R2 vars (optional; local/IDB fallback works): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (names as already documented)

No YouTube API key is required (oEmbed + committed catalog).

## 3. Refresh the YouTube catalog (optional)

```bash
npm run import:youtube          # from data/videos.json
npm run import:youtube -- --rss # from channel RSS (latest ~15)
```

Commits `src/lib/youtube-catalog.ts`.

## 4. How to try on the preview

1. Open home → upload a Thunderhill East CSV (TrackAddict with UTC Time preferred).
2. On the session page, attach suggestion **Thunderhill East ND Miata 2:17.1** (or paste `https://youtu.be/BI0ZwJiqYk8`).
3. Open the linked lap → use **Mark start/finish**, nudge (`,` / `.`), save offset.
4. Sign in → Account → **Import my local sessions** → Friends feed shows cloud sessions.
