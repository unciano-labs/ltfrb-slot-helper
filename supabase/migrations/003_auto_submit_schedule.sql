-- ============================================================================
-- Migration 003: Auto-submission schedule options (slot increase / 12 midnight / hourly)
-- ============================================================================

alter table public.ltfrb_application_profiles
  add column if not exists submit_on_slot_increase boolean not null default true,
  add column if not exists submit_at_midnight boolean not null default false,
  add column if not exists submit_hourly boolean not null default false;
