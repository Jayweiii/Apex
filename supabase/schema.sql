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
  raw_object_key text,
  video_object_key text,
  storage_backend text,
  created_at timestamptz not null default now()
);

create table if not exists public.laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lap_number int not null,
  lap_time_ms int not null,
  telemetry jsonb not null default '[]'::jsonb
);

create index if not exists sessions_user_id_idx on public.sessions (user_id, created_at desc);
create index if not exists sessions_track_class_idx on public.sessions (track_id, car_class);
create index if not exists laps_session_id_idx on public.laps (session_id, lap_number);
create index if not exists drivers_user_id_idx on public.drivers (user_id);

alter table public.drivers enable row level security;
alter table public.sessions enable row level security;
alter table public.laps enable row level security;

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
alter table public.sessions add column if not exists raw_object_key text;
alter table public.sessions add column if not exists video_object_key text;
alter table public.sessions add column if not exists storage_backend text;
