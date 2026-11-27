-- Add trigger metadata to application submission logs so users can see
-- whether each attempt was triggered by a slot increase, scheduled time, hourly schedule, or manual click.
alter table public.ltfrb_submission_logs
  add column if not exists trigger_type text,
  add column if not exists trigger_detail text;
