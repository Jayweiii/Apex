-- Enable UUID helpers
create extension if not exists "pgcrypto";

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  filename text,
  created_at timestamptz not null default now(),
  track_id text,
  track_name text,
  car text
);

-- Existing projects: run this in the Supabase SQL editor.
-- create table if not exists does not add columns to a table that is already there.
alter table public.sessions add column if not exists track_id text;
alter table public.sessions add column if not exists track_name text;
alter table public.sessions add column if not exists car text;

create table if not exists public.laps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lap_number int not null,
  lap_time_ms int not null,
  telemetry jsonb not null default '[]'::jsonb
);

create index if not exists sessions_user_id_idx on public.sessions (user_id, created_at desc);
create index if not exists sessions_track_id_idx on public.sessions (track_id);
create index if not exists laps_session_id_idx on public.laps (session_id, lap_number);

alter table public.sessions enable row level security;
alter table public.laps enable row level security;

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
  on public.sessions for select
  using (auth.uid() = user_id);

drop policy if exists "sessions_insert_own" on public.sessions;
create policy "sessions_insert_own"
  on public.sessions for insert
  with check (auth.uid() = user_id);

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
