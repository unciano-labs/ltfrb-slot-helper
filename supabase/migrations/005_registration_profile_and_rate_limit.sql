-- ============================================================================
-- Migration 005: Registration Profile Fields & Rate Limiting
-- ============================================================================

-- 1. Store registrant name and mobile on tenant subscriptions
alter table if exists public.ltfrb_subscriptions
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists mobile text;

-- 2. Persistent account registration rate-limit log (multi-tenant scoped)
create table if not exists public.ltfrb_registration_attempts (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  ip_hash text not null,
  email_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_reg_attempts_ip
  on public.ltfrb_registration_attempts (website_id, ip_hash, created_at desc);

create index if not exists idx_ltfrb_reg_attempts_email
  on public.ltfrb_registration_attempts (website_id, email_hash, created_at desc);

alter table public.ltfrb_registration_attempts enable row level security;
