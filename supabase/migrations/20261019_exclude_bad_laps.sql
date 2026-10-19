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
