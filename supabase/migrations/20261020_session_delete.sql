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
