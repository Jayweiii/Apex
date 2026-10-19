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
  exclude_reason text
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
alter table public.sessions add column if not exists raw_object_key text;
alter table public.sessions add column if not exists video_object_key text;
alter table public.sessions add column if not exists storage_backend text;
alter table public.sessions add column if not exists started_at timestamptz;
alter table public.sessions add column if not exists session_date date;
alter table public.laps add column if not exists start_offset_sec double precision;
alter table public.laps add column if not exists started_at_ms bigint;
alter table public.laps add column if not exists excluded boolean not null default false;
alter table public.laps add column if not exists exclude_reason text;

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

-- Friends (signed-in) can read each other's sessions, laps, and videos.
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
