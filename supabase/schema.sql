-- Apex canonical schema (greenfield).
-- Generated from supabase/schema base tables + supabase/migrations/*.sql in order.
-- Existing hosted projects should apply NEW migrations only (see list_migrations),
-- not re-run this whole file.
--
-- Prefer: run each file in supabase/migrations/ in filename order in the SQL editor.
-- Or: paste this file once for a brand-new empty project.

-- Enable UUID helpers
create extension if not exists "pgcrypto";

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, display_name)
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  filename text,
  track_id text,
  car text,
  car_class text,
  car_tags text[] not null default '{}',
  driver_id uuid references public.drivers (id) on delete set null,
  driver_name text,
  weather text,
  tires text,
  notes text,
  source_kind text not null default 'csv',
  gps_quality jsonb,
  source_gps jsonb,
  source_gps_object_key text,
  raw_object_key text,
  video_object_key text,
  storage_backend text,
  started_at timestamptz,
  session_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lap_number int not null,
  lap_time_ms int not null,
  telemetry jsonb not null default '[]'::jsonb,
  start_offset_sec double precision,
  started_at_ms bigint,
  excluded boolean not null default false,
  exclude_reason text,
  start_offset_override double precision,
  end_offset_override double precision
);

create table if not exists public.session_videos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('youtube', 'mp4')),
  youtube_id text,
  object_key text,
  title text,
  lap_id uuid references public.laps (id) on delete set null,
  offset_sec double precision not null default 0,
  rate double precision not null default 1,
  sync_source text not null default 'unsynced',
  video_started_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions (user_id, created_at desc);
create index if not exists sessions_track_class_idx on public.sessions (track_id, car_class);
create index if not exists laps_session_id_idx on public.laps (session_id, lap_number);
create index if not exists drivers_user_id_idx on public.drivers (user_id);
create index if not exists session_videos_session_id_idx on public.session_videos (session_id);

alter table public.drivers enable row level security;
alter table public.sessions enable row level security;
alter table public.laps enable row level security;
alter table public.session_videos enable row level security;

drop policy if exists "drivers_select_own" on public.drivers;
create policy "drivers_select_own"
  on public.drivers for select
  using (auth.uid() = user_id);

drop policy if exists "drivers_insert_own" on public.drivers;
create policy "drivers_insert_own"
  on public.drivers for insert
  with check (auth.uid() = user_id);

drop policy if exists "drivers_update_own" on public.drivers;
create policy "drivers_update_own"
  on public.drivers for update
  using (auth.uid() = user_id);

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
  on public.sessions for select
  using (auth.uid() = user_id);

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own"
  on public.sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own"
  on public.sessions for update
  using (auth.uid() = user_id);

drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own"
  on public.sessions for delete
  using (auth.uid() = user_id);

drop policy if exists "laps_select_own" on public.laps;
create policy "laps_select_own"
  on public.laps for select
  using (auth.uid() = user_id);

drop policy if exists "laps_insert_own" on public.laps;
create policy "laps_insert_own"
  on public.laps for insert
  with check (auth.uid() = user_id);

drop policy if exists "laps_delete_own" on public.laps;
create policy "laps_delete_own"
  on public.laps for delete
  using (auth.uid() = user_id);

drop policy if exists "laps_update_own" on public.laps;
create policy "laps_update_own"
  on public.laps for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Additive migration helpers for existing projects created from the earlier schema.
alter table public.sessions add column if not exists track_id text;
alter table public.sessions add column if not exists car text;
alter table public.sessions add column if not exists car_class text;
alter table public.sessions add column if not exists car_tags text[] not null default '{}';
alter table public.sessions add column if not exists driver_id uuid references public.drivers (id) on delete set null;
alter table public.sessions add column if not exists driver_name text;
alter table public.sessions add column if not exists weather text;
alter table public.sessions add column if not exists tires text;
alter table public.sessions add column if not exists notes text;
alter table public.sessions add column if not exists source_kind text not null default 'csv';
alter table public.sessions add column if not exists gps_quality jsonb;
alter table public.sessions add column if not exists source_gps jsonb;
alter table public.sessions add column if not exists source_gps_object_key text;
alter table public.sessions add column if not exists raw_object_key text;
alter table public.sessions add column if not exists video_object_key text;
alter table public.sessions add column if not exists storage_backend text;
alter table public.sessions add column if not exists started_at timestamptz;
alter table public.sessions add column if not exists session_date date;
alter table public.laps add column if not exists start_offset_sec double precision;
alter table public.laps add column if not exists started_at_ms bigint;
alter table public.laps add column if not exists excluded boolean not null default false;
alter table public.laps add column if not exists exclude_reason text;
alter table public.laps add column if not exists start_offset_override double precision;
alter table public.laps add column if not exists end_offset_override double precision;

drop policy if exists "session_videos_select_own" on public.session_videos;
create policy "session_videos_select_own"
  on public.session_videos for select
  using (auth.uid() = user_id);

drop policy if exists "session_videos_insert_own" on public.session_videos;
create policy "session_videos_insert_own"
  on public.session_videos for insert
  with check (auth.uid() = user_id);

drop policy if exists "session_videos_update_own" on public.session_videos;
create policy "session_videos_update_own"
  on public.session_videos for update
  using (auth.uid() = user_id);

drop policy if exists "session_videos_delete_own" on public.session_videos;
create policy "session_videos_delete_own"
  on public.session_videos for delete
  using (auth.uid() = user_id);

-- ========== Migrations (ordered) ==========

-- >>> 20261006_youtube_sync_friends.sql
-- Apex YouTube sync + friends visibility migration
-- Run in the Supabase SQL editor after deploying this branch.

alter table public.sessions add column if not exists started_at timestamptz;
alter table public.sessions add column if not exists session_date date;

alter table public.laps add column if not exists start_offset_sec double precision;
alter table public.laps add column if not exists started_at_ms bigint;

create table if not exists public.session_videos (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('youtube', 'mp4')),
  youtube_id text,
  object_key text,
  title text,
  lap_id uuid references public.laps (id) on delete set null,
  offset_sec double precision not null default 0,
  rate double precision not null default 1,
  sync_source text not null default 'unsynced',
  video_started_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists session_videos_session_id_idx
  on public.session_videos (session_id);
create index if not exists session_videos_user_id_idx
  on public.session_videos (user_id);

alter table public.session_videos enable row level security;

-- Owners manage their videos
drop policy if exists "session_videos_select_own" on public.session_videos;
create policy "session_videos_select_own"
  on public.session_videos for select
  using (auth.uid() = user_id);

drop policy if exists "session_videos_insert_own" on public.session_videos;
create policy "session_videos_insert_own"
  on public.session_videos for insert
  with check (auth.uid() = user_id);

drop policy if exists "session_videos_update_own" on public.session_videos;
create policy "session_videos_update_own"
  on public.session_videos for update
  using (auth.uid() = user_id);

drop policy if exists "session_videos_delete_own" on public.session_videos;
create policy "session_videos_delete_own"
  on public.session_videos for delete
  using (auth.uid() = user_id);

-- Friends (any signed-in user) can read sessions / laps / videos.
-- Tighten later with an explicit share table if needed.
drop policy if exists "sessions_select_authenticated" on public.sessions;
create policy "sessions_select_authenticated"
  on public.sessions for select
  to authenticated
  using (true);

drop policy if exists "laps_select_authenticated" on public.laps;
create policy "laps_select_authenticated"
  on public.laps for select
  to authenticated
  using (true);

drop policy if exists "session_videos_select_authenticated" on public.session_videos;
create policy "session_videos_select_authenticated"
  on public.session_videos for select
  to authenticated
  using (true);

drop policy if exists "drivers_select_authenticated" on public.drivers;
create policy "drivers_select_authenticated"
  on public.drivers for select
  to authenticated
  using (true);

-- >>> 20261017_guest_upload_rate_limits.sql
-- Optional upload event log for IP-based rate limits (guests + signed-in).
-- Filename: supabase/migrations/20261017_guest_upload_rate_limits.sql
-- Run after enabling Anonymous sign-ins in Authentication → Providers.

create table if not exists public.upload_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  ip_hash text,
  kind text not null default 'session',
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists upload_events_user_created_idx
  on public.upload_events (user_id, created_at desc);

create index if not exists upload_events_ip_created_idx
  on public.upload_events (ip_hash, created_at desc);

alter table public.upload_events enable row level security;

drop policy if exists "upload_events_insert_own" on public.upload_events;
create policy "upload_events_insert_own"
  on public.upload_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "upload_events_select_own" on public.upload_events;
create policy "upload_events_select_own"
  on public.upload_events for select
  using (auth.uid() = user_id);

-- Owners already have update/delete on their sessions via existing policies.
-- No change required for owner-only edit/delete.

-- >>> 20261017_session_visibility.sql
-- Session visibility: private | friends | public
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261017_session_visibility.sql
--
-- Live status (2026-10-17): this migration is NOT applied yet.
-- Applied migrations are only apex_base_schema + youtube_sync_friends.
-- Until this runs, Public uploads silently drop visibility and toggle updates fail.
-- After apply: signed-out users can SELECT public sessions/laps (needed for
-- public cross-session compare). Friends visibility still requires auth.uid().

alter table public.sessions
  add column if not exists visibility text not null default 'friends';

-- Backfill / constrain
update public.sessions
set visibility = 'friends'
where visibility is null
   or visibility not in ('private', 'friends', 'public');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sessions_visibility_check'
  ) then
    alter table public.sessions
      add constraint sessions_visibility_check
      check (visibility in ('private', 'friends', 'public'));
  end if;
end $$;

create index if not exists sessions_visibility_idx
  on public.sessions (visibility, created_at desc);

-- Jason's Public upload at 19:34 UTC — column did not exist yet, so mark it public.
update public.sessions
set visibility = 'public'
where id = '1c782e8b-c306-4c05-90d6-738bb948eee8';

-- Replace blanket "any authenticated can read everything" policies
-- with visibility-aware rules. Owners always see their own rows.
-- Public rows are readable by anon (signed-out) via visibility = 'public'.

drop policy if exists "sessions_select_authenticated" on public.sessions;
drop policy if exists "sessions_select_own" on public.sessions;
drop policy if exists "sessions_select_visible" on public.sessions;
create policy "sessions_select_visible"
  on public.sessions for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and auth.uid() is not null)
  );

drop policy if exists "laps_select_authenticated" on public.laps;
drop policy if exists "laps_select_own" on public.laps;
drop policy if exists "laps_select_visible" on public.laps;
create policy "laps_select_visible"
  on public.laps for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.sessions s
      where s.id = laps.session_id
        and (
          s.user_id = auth.uid()
          or s.visibility = 'public'
          or (s.visibility = 'friends' and auth.uid() is not null)
        )
    )
  );

drop policy if exists "session_videos_select_authenticated" on public.session_videos;
drop policy if exists "session_videos_select_own" on public.session_videos;
drop policy if exists "session_videos_select_visible" on public.session_videos;
create policy "session_videos_select_visible"
  on public.session_videos for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.sessions s
      where s.id = session_videos.session_id
        and (
          s.user_id = auth.uid()
          or s.visibility = 'public'
          or (s.visibility = 'friends' and auth.uid() is not null)
        )
    )
  );

-- Owners can update visibility (and other fields)
drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- >>> 20261017_shared_tracks.sql
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

-- >>> 20261018_gps_quality.sql
-- GPS quality summary for GoPro / phone telemetry preference in compare.
alter table public.sessions
  add column if not exists gps_quality jsonb;

comment on column public.sessions.gps_quality is
  'GPS quality summary (stream, rank, precision, fix) — prefer GoPro over phone in compare.';

-- >>> 20261019_comparisons.sql
-- Saved comparisons: shareable / forkable multi-lap compares (up to 4).
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261019_comparisons.sql
--
-- RLS: public rows readable by anon; owner update/delete; any auth (incl. anon guest) can insert.

create table if not exists public.comparisons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled comparison',
  description text,
  visibility text not null default 'public'
    check (visibility in ('private', 'friends', 'public')),
  -- items: [{ session_id, lap_id, lap_number?, color?, offset_sec?, video_id? }, ...] max 4
  items jsonb not null default '[]'::jsonb,
  -- index into items (0-based) that is the reference lap
  reference_index int not null default 0,
  analysis_mode text not null default 'snapped'
    check (analysis_mode in ('raw', 'snapped')),
  -- optional UI state: { progress?, zoom?, followLapIndex? }
  cursor_state jsonb,
  forked_from uuid references public.comparisons (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comparisons_user_id_idx
  on public.comparisons (user_id, updated_at desc);

create index if not exists comparisons_visibility_idx
  on public.comparisons (visibility, updated_at desc);

create index if not exists comparisons_forked_from_idx
  on public.comparisons (forked_from)
  where forked_from is not null;

-- updated_at trigger
create or replace function public.set_comparisons_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists comparisons_set_updated_at on public.comparisons;
create trigger comparisons_set_updated_at
  before update on public.comparisons
  for each row execute function public.set_comparisons_updated_at();

alter table public.comparisons enable row level security;

-- SELECT: owner, public (incl. anon), friends (any signed-in)
drop policy if exists "comparisons_select_visible" on public.comparisons;
create policy "comparisons_select_visible"
  on public.comparisons for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and auth.uid() is not null)
  );

-- INSERT: any authenticated user (email or anonymous guest)
drop policy if exists "comparisons_insert_own" on public.comparisons;
create policy "comparisons_insert_own"
  on public.comparisons for insert
  with check (auth.uid() = user_id);

-- UPDATE / DELETE: owner only
drop policy if exists "comparisons_update_own" on public.comparisons;
create policy "comparisons_update_own"
  on public.comparisons for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "comparisons_delete_own" on public.comparisons;
create policy "comparisons_delete_own"
  on public.comparisons for delete
  using (auth.uid() = user_id);

-- >>> 20261019_exclude_bad_laps.sql
-- Exclude bad / partial laps from session best, theoretical best, sector
-- bests, leaderboards, and default compare reference.
-- Run in the Supabase SQL editor for project Apex.
-- Filename: supabase/migrations/20261019_exclude_bad_laps.sql
--
-- Owners toggle excluded on the session page. Auto-flag heuristics are
-- client-side only (warning + one-click exclude) — never auto-exclude.

alter table public.laps
  add column if not exists excluded boolean not null default false;

alter table public.laps
  add column if not exists exclude_reason text;

comment on column public.laps.excluded is
  'When true, ignore for session best / theoretical best / corner bests / leaderboards / default compare ref. Lap stays viewable.';

comment on column public.laps.exclude_reason is
  'Optional note when excluded (manual or auto-flag summary from one-click exclude).';

create index if not exists laps_session_excluded_idx
  on public.laps (session_id, excluded)
  where excluded = false;

-- Owner-only UPDATE (select/insert/delete already exist; update was missing).
drop policy if exists "laps_update_own" on public.laps;
create policy "laps_update_own"
  on public.laps for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- >>> 20261019_lap_trim_overrides.sql
-- Lap boundary trim overrides (owner tunes start/end splitter timestamps).
-- Run in the Supabase SQL editor for project Apex.
-- Filename: supabase/migrations/20261019_lap_trim_overrides.sql
--
-- Original telemetry + start_offset_sec stay intact (auto). Overrides are
-- absolute session-time seconds; null = use auto. Client recomputes
-- lap_time_ms / charts / map live and persists lap_time_ms on save.
-- Owner-only UPDATE already covered by laps_update_own (exclude migration).

alter table public.laps
  add column if not exists start_offset_override double precision;

alter table public.laps
  add column if not exists end_offset_override double precision;

comment on column public.laps.start_offset_override is
  'Optional absolute session-time start (seconds). Null = use start_offset_sec (auto).';

comment on column public.laps.end_offset_override is
  'Optional absolute session-time end (seconds). Null = auto end from telemetry.';

-- Ensure owner-only update policy exists (idempotent with exclude migration).
drop policy if exists "laps_update_own" on public.laps;
create policy "laps_update_own"
  on public.laps for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- >>> 20261019_lap_videos.sql
-- Per-lap / session-level YouTube links (multi-video sessions)
-- Filename: supabase/migrations/20261019_lap_videos.sql
-- Run in the Supabase SQL editor for project Apex after deploying this branch.
--
-- Model:
--   • session_videos rows with lap_id set  → one onboard clip for that lap
--   • session_videos rows with lap_id null → session-level video (offset applies
--     at each lap start via laps.start_offset_sec)
--   • lap_index mirrors laps.lap_number for bulk paste assignment
-- YouTube-only for new attaches (provider = 'youtube').
--
-- Also exposes view public.lap_videos for ops (security_invoker → same RLS).

alter table public.session_videos
  add column if not exists lap_index integer;

alter table public.session_videos
  add column if not exists youtube_url text;

comment on column public.session_videos.lap_id is
  'Lap this clip covers. Null = session-level video spanning many laps.';
comment on column public.session_videos.lap_index is
  '1-based lap_number for bulk URL paste; kept in sync with lap_id when set.';
comment on column public.session_videos.youtube_url is
  'Original pasted YouTube URL (optional; youtube_id is canonical).';

update public.session_videos sv
set lap_index = l.lap_number
from public.laps l
where sv.lap_id = l.id
  and sv.lap_index is null;

create unique index if not exists session_videos_one_youtube_per_lap_idx
  on public.session_videos (session_id, lap_id)
  where provider = 'youtube' and lap_id is not null;

create or replace view public.lap_videos
  with (security_invoker = true)
as
select
  id,
  session_id,
  user_id as owner,
  lap_id,
  lap_index,
  youtube_id,
  youtube_url,
  title,
  offset_sec as offset_seconds,
  rate,
  sync_source,
  video_started_at,
  created_at
from public.session_videos
where provider = 'youtube';

grant select on public.lap_videos to anon, authenticated;
grant insert, update, delete on public.lap_videos to authenticated;

drop policy if exists "session_videos_select_authenticated" on public.session_videos;
drop policy if exists "session_videos_select_own" on public.session_videos;
drop policy if exists "session_videos_select_visible" on public.session_videos;
create policy "session_videos_select_visible"
  on public.session_videos for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.sessions s
      where s.id = session_videos.session_id
        and (
          s.user_id = auth.uid()
          or s.visibility = 'public'
          or (s.visibility = 'friends' and auth.uid() is not null)
        )
    )
  );

-- >>> 20261019_session_source_gps.sql
-- Full-resolution GPS track for owner re-split (no video).
-- Compact jsonb array of { t, lat, lon, s?, a?, b? } — see src/lib/session-reparse.ts.
-- Run in the Supabase SQL editor (Jason) after deploying this branch.

alter table public.sessions
  add column if not exists source_gps jsonb;

comment on column public.sessions.source_gps is
  'Full-res GPS samples for re-parsing laps (compact jsonb). Video is never stored.';

-- >>> 20261019_shared_cars.sql
-- Shared community cars (readable by everyone, including signed-out).
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261019_shared_cars.sql

create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists cars_name_uidx
  on public.cars (lower(btrim(name)));

create index if not exists cars_created_at_idx
  on public.cars (created_at desc);

alter table public.cars enable row level security;

drop policy if exists "cars_select_all" on public.cars;
create policy "cars_select_all"
  on public.cars for select
  using (true);

drop policy if exists "cars_insert_authenticated" on public.cars;
create policy "cars_insert_authenticated"
  on public.cars for insert
  with check (auth.uid() is not null);

drop policy if exists "cars_update_own" on public.cars;
create policy "cars_update_own"
  on public.cars for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Backfill from existing session car names (no demo/fake rows).
insert into public.cars (name, created_by)
select distinct on (lower(btrim(s.car)))
  btrim(s.car) as name,
  s.user_id as created_by
from public.sessions s
where s.car is not null
  and btrim(s.car) <> ''
order by lower(btrim(s.car)), s.created_at asc
on conflict do nothing;

-- >>> 20261020_session_delete.sql
-- Owner-only session delete (RLS) + cascade already on laps / session_videos.
-- Filename for Jason: supabase/migrations/20261020_session_delete.sql
-- Project Apex — run in the Supabase SQL editor.
--
-- Deleting a session cascades:
--   public.laps              ON DELETE CASCADE
--   public.session_videos    ON DELETE CASCADE
-- Trim overrides + exclude flags live on laps → go with the lap rows.
-- Comparisons store session_id inside jsonb `items` (no FK). App scrub
-- removes the owner's comparison items / deletes comps with <2 laps left;
-- other users' comps surface missing slots at load. Leaderboards / track
-- stats are query-derived and update once the session row is gone.

-- Ensure owner-only DELETE on sessions (idempotent).
drop policy if exists "sessions_delete_own" on public.sessions;
create policy "sessions_delete_own"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- Laps / videos: owners can delete their own rows (cascade also covers
-- children when the parent session is deleted under the owner policy).
drop policy if exists "laps_delete_own" on public.laps;
create policy "laps_delete_own"
  on public.laps for delete
  using (auth.uid() = user_id);

drop policy if exists "session_videos_delete_own" on public.session_videos;
create policy "session_videos_delete_own"
  on public.session_videos for delete
  using (auth.uid() = user_id);

-- Comparisons: owner update/delete (only if table already exists).
do $$
begin
  if to_regclass('public.comparisons') is null then
    return;
  end if;
  execute 'drop policy if exists "comparisons_update_own" on public.comparisons';
  execute $p$
    create policy "comparisons_update_own"
      on public.comparisons for update
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id)
  $p$;
  execute 'drop policy if exists "comparisons_delete_own" on public.comparisons';
  execute $p$
    create policy "comparisons_delete_own"
      on public.comparisons for delete
      using (auth.uid() = user_id)
  $p$;
end $$;

-- >>> 20261020_source_gps_fullres.sql
-- Full-resolution source_gps encoding (v2 columnar delta+gzip) + optional Storage
-- for payloads that exceed ~1MB inline jsonb.
--
-- Filename for Jason: supabase/migrations/20261020_source_gps_fullres.sql
-- Run in the Supabase SQL editor after deploying this branch (xhysarrdspledfenabnz).
--
-- Why: a prior repair wrote stitched downsampled lap telemetry (~144 pts / ~3KB)
-- into sessions.source_gps. New uploads store native-rate GPS (GoPro ~10–18 Hz,
-- CSV at logger rate) via src/lib/source-gps-codec.ts. Re-parse must never
-- promote coarse lap stitches into source_gps.

comment on column public.sessions.source_gps is
  'Full-res GPS for re-parse. v2: {v:2,enc:col-d32-gz-b64,n,ch,scale,data} columnar delta-int gzip+base64 (t,lat,lon,s,alt,hdg,a,b). Legacy v1: jsonb array of {t,lat,lon,s?,a?,b?}. Never downsampled lap stitches.';

alter table public.sessions
  add column if not exists source_gps_object_key text;

comment on column public.sessions.source_gps_object_key is
  'When source_gps payload would exceed ~1MB, gzip bytes live in storage bucket source-gps at this object key; source_gps jsonb holds a small {v:2,enc:storage,key} stub.';

-- Private bucket for oversized full-res GPS blobs (owners only via path prefix).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-gps',
  'source-gps',
  false,
  52428800, -- 50 MB
  array['application/gzip', 'application/octet-stream']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {user_id}/{session_id}.source_gps.gz
drop policy if exists "source_gps_select_own" on storage.objects;
create policy "source_gps_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_insert_own" on storage.objects;
create policy "source_gps_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_update_own" on storage.objects;
create policy "source_gps_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_delete_own" on storage.objects;
create policy "source_gps_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- >>> 20261021_track_start_finish_edit.sql
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

-- >>> 20261026_perf_query_indexes.sql
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

-- >>> 20261028_friendships.sql
-- Real friends graph for visibility = 'friends'.
-- Additive / non-destructive: new table + policy tighten. Existing public/private
-- sessions keep working. Friends-visible rows become readable only by accepted
-- friends (plus owner). Signed-in strangers no longer see friends sessions.
--
-- Project: Apex (xhysarrdspledfenabnz)
-- Filename: supabase/migrations/20261028_friendships.sql

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

create or replace function public.set_friendships_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_friendships_updated_at();

alter table public.friendships enable row level security;

-- Participants can read their rows.
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Only the requester inserts (pending).
drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester"
  on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Either party can update (accept / block / cancel via status).
drop policy if exists "friendships_update_participants" on public.friendships;
create policy "friendships_update_participants"
  on public.friendships for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Either party can delete the row.
drop policy if exists "friendships_delete_participants" on public.friendships;
create policy "friendships_delete_participants"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- True when auth.uid() has an accepted friendship with other_id (either direction).
create or replace function public.is_friend_of(other_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    other_id is not null
    and auth.uid() is not null
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = other_id)
          or (f.addressee_id = auth.uid() and f.requester_id = other_id)
        )
    );
$$;

revoke all on function public.is_friend_of(uuid) from public;
grant execute on function public.is_friend_of(uuid) to authenticated, anon;

-- Request a friendship by email (looks up auth.users).
create or replace function public.request_friend_by_email(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  existing_id uuid;
  fid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if target_email is null or btrim(target_email) = '' then
    raise exception 'Email required';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(btrim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'No Apex account with that email';
  end if;
  if target_id = auth.uid() then
    raise exception 'Cannot friend yourself';
  end if;

  -- Already friends / pending either direction?
  select f.id into existing_id
  from public.friendships f
  where (
      (f.requester_id = auth.uid() and f.addressee_id = target_id)
      or (f.addressee_id = auth.uid() and f.requester_id = target_id)
    )
    and f.status in ('pending', 'accepted')
  limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), target_id, 'pending')
  returning id into fid;
  return fid;
end;
$$;

revoke all on function public.request_friend_by_email(text) from public;
grant execute on function public.request_friend_by_email(text) to authenticated;

-- Tighten visibility policies: friends ≠ accepted friendship, not any signed-in user.
drop policy if exists "sessions_select_visible" on public.sessions;
create policy "sessions_select_visible"
  on public.sessions for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and public.is_friend_of(user_id))
  );

drop policy if exists "laps_select_visible" on public.laps;
create policy "laps_select_visible"
  on public.laps for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.sessions s
      where s.id = laps.session_id
        and (
          s.user_id = auth.uid()
          or s.visibility = 'public'
          or (s.visibility = 'friends' and public.is_friend_of(s.user_id))
        )
    )
  );

drop policy if exists "session_videos_select_visible" on public.session_videos;
create policy "session_videos_select_visible"
  on public.session_videos for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.sessions s
      where s.id = session_videos.session_id
        and (
          s.user_id = auth.uid()
          or s.visibility = 'public'
          or (s.visibility = 'friends' and public.is_friend_of(s.user_id))
        )
    )
  );

drop policy if exists "comparisons_select_visible" on public.comparisons;
create policy "comparisons_select_visible"
  on public.comparisons for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and public.is_friend_of(user_id))
  );

-- New comparisons default to friends (not public) so telemetry is not shared
-- until the owner chooses a Public link.
alter table public.comparisons
  alter column visibility set default 'friends';
