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
