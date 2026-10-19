-- Shared community cars (readable by everyone, including signed-out).
-- Run in the Supabase SQL editor for project Apex (xhysarrdspledfenabnz).
-- Filename: supabase/migrations/20261019_shared_cars.sql

create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists cars_name_uidx
  on public.cars (lower(btrim(name)));

create index if not exists cars_created_at_idx
  on public.cars (created_at desc);

alter table public.cars enable row level security;

drop policy if exists "cars_select_all" on public.cars;
create policy "cars_select_all"
  on public.cars for select
  using (true);

drop policy if exists "cars_insert_authenticated" on public.cars;
create policy "cars_insert_authenticated"
  on public.cars for insert
  with check (auth.uid() is not null);

drop policy if exists "cars_update_own" on public.cars;
create policy "cars_update_own"
  on public.cars for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Backfill from existing session car names (no demo/fake rows).
insert into public.cars (name, created_by)
select distinct on (lower(btrim(s.car)))
  btrim(s.car) as name,
  s.user_id as created_by
from public.sessions s
where s.car is not null
  and btrim(s.car) <> ''
order by lower(btrim(s.car)), s.created_at asc
on conflict do nothing;
