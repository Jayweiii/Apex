-- Performance indexes for compare / home / account list queries.
-- Safe to re-run (IF NOT EXISTS). Jason: paste into Supabase SQL editor if
-- the hosted DB is not applying repo migrations automatically.
--
-- Already present (do not recreate):
--   sessions_visibility_idx (visibility, created_at desc)
--   sessions_user_id_idx (user_id, created_at desc)
--   laps_session_id_idx (session_id, lap_number)
--
-- New:
--   * same-track peer lists for compare (track_id + created_at)
--   * account best-lap lookups that ignore excluded rows
--   * user + visibility filter for My Sessions / friends browse

create index if not exists sessions_track_created_idx
  on public.sessions (track_id, created_at desc);

create index if not exists sessions_user_visibility_created_idx
  on public.sessions (user_id, visibility, created_at desc);

create index if not exists laps_session_time_idx
  on public.laps (session_id, lap_time_ms)
  where excluded is not true;

analyze public.sessions;
analyze public.laps;
