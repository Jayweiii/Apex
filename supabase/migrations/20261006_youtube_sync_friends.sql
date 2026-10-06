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
