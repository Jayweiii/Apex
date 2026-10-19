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
