-- GPS quality summary for GoPro / phone telemetry preference in compare.
alter table public.sessions
  add column if not exists gps_quality jsonb;

comment on column public.sessions.gps_quality is
  'GPS quality summary (stream, rank, precision, fix) — prefer GoPro over phone in compare.';
