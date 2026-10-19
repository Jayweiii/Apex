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
