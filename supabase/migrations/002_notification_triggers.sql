-- ============================================================================
-- Migration 002: User-selectable notification triggers per watch rule
-- ============================================================================

alter table public.ltfrb_watch_rules
  add column if not exists notify_when_available boolean not null default true,
  add column if not exists notify_when_increased boolean not null default true,
  add column if not exists notify_when_decreased boolean not null default false;
