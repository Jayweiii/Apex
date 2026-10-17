-- Session visibility: private | friends | public
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261017_session_visibility.sql

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

-- Replace blanket "any authenticated can read everything" policies
-- with visibility-aware rules. Owners always see their own rows.

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

-- Owners can still update visibility (and other fields)
drop policy if exists "sessions_update_own" on public.sessions;
create policy "sessions_update_own"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
