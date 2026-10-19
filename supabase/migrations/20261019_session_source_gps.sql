-- Full-resolution GPS track for owner re-split (no video).
-- Compact jsonb array of { t, lat, lon, s?, a?, b? } — see src/lib/session-reparse.ts.
-- Run in the Supabase SQL editor (Jason) after deploying this branch.

alter table public.sessions
  add column if not exists source_gps jsonb;

comment on column public.sessions.source_gps is
  'Full-res GPS samples for re-parsing laps (compact jsonb). Video is never stored.';
