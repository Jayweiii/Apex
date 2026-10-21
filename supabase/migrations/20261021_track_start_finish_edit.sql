-- Track start/finish line editing: owner (or session owner of that track) can
-- update tracks.start_finish / lat / lon. Readable by everyone (existing select).
-- Filename: supabase/migrations/20261021_track_start_finish_edit.sql
-- Project: Apex (xhysarrdspledfenabnz)

-- Ensure start_finish column exists (shared_tracks migration).
alter table public.tracks
  add column if not exists start_finish jsonb;

comment on column public.tracks.start_finish is
  'SF gate: {lat,lon,headingDeg?} or {a:{lat,lon},b:{lat,lon},lat,lon,headingDeg?}. Owner-editable.';

-- Owners can update their tracks (already present as tracks_update_own).
-- Also allow authenticated users who own a session on this track to nudge SF
-- (common when the community row was created by someone else).
drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own"
  on public.tracks for update
  using (
    auth.uid() = created_by
    or exists (
      select 1 from public.sessions s
      where s.track_id = tracks.id
        and s.user_id = auth.uid()
    )
  )
  with check (
    auth.uid() = created_by
    or exists (
      select 1 from public.sessions s
      where s.track_id = tracks.id
        and s.user_id = auth.uid()
    )
  );

-- Seed Thunderhill West timing line when the community row exists.
update public.tracks
set
  lat = 39.53776,
  lon = -122.33875,
  start_finish = coalesce(
    start_finish,
    jsonb_build_object(
      'lat', 39.53776,
      'lon', -122.33875,
      'headingDeg', 175,
      'a', jsonb_build_object('lat', 39.53776, 'lon', -122.33888),
      'b', jsonb_build_object('lat', 39.53776, 'lon', -122.33862)
    )
  )
where id = 'custom-thunderhill-west'
  and (
    start_finish is null
    or abs(coalesce((start_finish->>'lat')::float8, lat) - 39.53905) < 0.0002
  );
