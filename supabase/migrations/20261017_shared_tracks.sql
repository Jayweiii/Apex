-- Shared community tracks (readable by everyone, including signed-out).
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261017_shared_tracks.sql

create table if not exists public.tracks (
  id text primary key,
  name text not null,
  location text not null default '',
  layout text,
  lat double precision not null default 0,
  lon double precision not null default 0,
  -- Optional start/finish: { "lat": n, "lon": n } or { "a": {...}, "b": {...} }
  start_finish jsonb,
  -- Optional centerline polyline: [ { "lat": n, "lon": n }, ... ]
  centerline jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Avoid duplicate tracks by name + location (case-insensitive).
create unique index if not exists tracks_name_location_uidx
  on public.tracks (lower(btrim(name)), lower(btrim(location)));

create index if not exists tracks_created_at_idx
  on public.tracks (created_at desc);

alter table public.tracks enable row level security;

drop policy if exists "tracks_select_all" on public.tracks;
create policy "tracks_select_all"
  on public.tracks for select
  using (true);

drop policy if exists "tracks_insert_authenticated" on public.tracks;
create policy "tracks_insert_authenticated"
  on public.tracks for insert
  with check (auth.uid() is not null);

drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own"
  on public.tracks for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Backfill community tracks from existing custom-* session track_ids.
insert into public.tracks (id, name, location, created_by)
select distinct on (s.track_id)
  s.track_id as id,
  initcap(replace(regexp_replace(s.track_id, '^custom-', ''), '-', ' ')) as name,
  'Community' as location,
  s.user_id as created_by
from public.sessions s
where s.track_id is not null
  and s.track_id like 'custom-%'
order by s.track_id, s.created_at asc
on conflict (id) do nothing;
