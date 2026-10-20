-- Full-resolution source_gps encoding (v2 columnar delta+gzip) + optional Storage
-- for payloads that exceed ~1MB inline jsonb.
--
-- Filename for Jason: supabase/migrations/20261020_source_gps_fullres.sql
-- Run in the Supabase SQL editor after deploying this branch (xhysarrdspledfenabnz).
--
-- Why: a prior repair wrote stitched downsampled lap telemetry (~144 pts / ~3KB)
-- into sessions.source_gps. New uploads store native-rate GPS (GoPro ~10–18 Hz,
-- CSV at logger rate) via src/lib/source-gps-codec.ts. Re-parse must never
-- promote coarse lap stitches into source_gps.

comment on column public.sessions.source_gps is
  'Full-res GPS for re-parse. v2: {v:2,enc:col-d32-gz-b64,n,ch,scale,data} columnar delta-int gzip+base64 (t,lat,lon,s,alt,hdg,a,b). Legacy v1: jsonb array of {t,lat,lon,s?,a?,b?}. Never downsampled lap stitches.';

alter table public.sessions
  add column if not exists source_gps_object_key text;

comment on column public.sessions.source_gps_object_key is
  'When source_gps payload would exceed ~1MB, gzip bytes live in storage bucket source-gps at this object key; source_gps jsonb holds a small {v:2,enc:storage,key} stub.';

-- Private bucket for oversized full-res GPS blobs (owners only via path prefix).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-gps',
  'source-gps',
  false,
  52428800, -- 50 MB
  array['application/gzip', 'application/octet-stream']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: {user_id}/{session_id}.source_gps.gz
drop policy if exists "source_gps_select_own" on storage.objects;
create policy "source_gps_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_insert_own" on storage.objects;
create policy "source_gps_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_update_own" on storage.objects;
create policy "source_gps_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "source_gps_delete_own" on storage.objects;
create policy "source_gps_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'source-gps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
