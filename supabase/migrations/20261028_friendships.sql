-- Real friends graph for visibility = 'friends'.
-- Additive / non-destructive: new table + policy tighten. Existing public/private
-- sessions keep working. Friends-visible rows become readable only by accepted
-- friends (plus owner). Signed-in strangers no longer see friends sessions.
--
-- Project: Apex (xhysarrdspledfenabnz)
-- Filename: supabase/migrations/20261028_friendships.sql

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> addressee_id),
  unique (requester_id, addressee_id)
);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id, status);

create or replace function public.set_friendships_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_friendships_updated_at();

alter table public.friendships enable row level security;

-- Participants can read their rows.
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Only the requester inserts (pending).
drop policy if exists "friendships_insert_requester" on public.friendships;
create policy "friendships_insert_requester"
  on public.friendships for insert
  with check (auth.uid() = requester_id and status = 'pending');

-- Either party can update (accept / block / cancel via status).
drop policy if exists "friendships_update_participants" on public.friendships;
create policy "friendships_update_participants"
  on public.friendships for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Either party can delete the row.
drop policy if exists "friendships_delete_participants" on public.friendships;
create policy "friendships_delete_participants"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- True when auth.uid() has an accepted friendship with other_id (either direction).
create or replace function public.is_friend_of(other_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    other_id is not null
    and auth.uid() is not null
    and exists (
      select 1
      from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = other_id)
          or (f.addressee_id = auth.uid() and f.requester_id = other_id)
        )
    );
$$;

revoke all on function public.is_friend_of(uuid) from public;
grant execute on function public.is_friend_of(uuid) to authenticated, anon;

-- Request a friendship by email (looks up auth.users).
create or replace function public.request_friend_by_email(target_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  existing_id uuid;
  fid uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  if target_email is null or btrim(target_email) = '' then
    raise exception 'Email required';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(btrim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'No Apex account with that email';
  end if;
  if target_id = auth.uid() then
    raise exception 'Cannot friend yourself';
  end if;

  -- Already friends / pending either direction?
  select f.id into existing_id
  from public.friendships f
  where (
      (f.requester_id = auth.uid() and f.addressee_id = target_id)
      or (f.addressee_id = auth.uid() and f.requester_id = target_id)
    )
    and f.status in ('pending', 'accepted')
  limit 1;
  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.friendships (requester_id, addressee_id, status)
  values (auth.uid(), target_id, 'pending')
  returning id into fid;
  return fid;
end;
$$;

revoke all on function public.request_friend_by_email(text) from public;
grant execute on function public.request_friend_by_email(text) to authenticated;

-- Tighten visibility policies: friends ≠ accepted friendship, not any signed-in user.
drop policy if exists "sessions_select_visible" on public.sessions;
create policy "sessions_select_visible"
  on public.sessions for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and public.is_friend_of(user_id))
  );

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
          or (s.visibility = 'friends' and public.is_friend_of(s.user_id))
        )
    )
  );

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
          or (s.visibility = 'friends' and public.is_friend_of(s.user_id))
        )
    )
  );

drop policy if exists "comparisons_select_visible" on public.comparisons;
create policy "comparisons_select_visible"
  on public.comparisons for select
  using (
    auth.uid() = user_id
    or visibility = 'public'
    or (visibility = 'friends' and public.is_friend_of(user_id))
  );

-- New comparisons default to friends (not public) so telemetry is not shared
-- until the owner chooses a Public link.
alter table public.comparisons
  alter column visibility set default 'friends';
