-- Optional upload event log for IP-based rate limits (guests + signed-in).
-- Filename: supabase/migrations/20261017_guest_upload_rate_limits.sql
-- Run after enabling Anonymous sign-ins in Authentication → Providers.

create table if not exists public.upload_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  ip_hash text,
  kind text not null default 'session',
  bytes bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists upload_events_user_created_idx
  on public.upload_events (user_id, created_at desc);

create index if not exists upload_events_ip_created_idx
  on public.upload_events (ip_hash, created_at desc);

alter table public.upload_events enable row level security;

drop policy if exists "upload_events_insert_own" on public.upload_events;
create policy "upload_events_insert_own"
  on public.upload_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "upload_events_select_own" on public.upload_events;
create policy "upload_events_select_own"
  on public.upload_events for select
  using (auth.uid() = user_id);

-- Owners already have update/delete on their sessions via existing policies.
-- No change required for owner-only edit/delete.
