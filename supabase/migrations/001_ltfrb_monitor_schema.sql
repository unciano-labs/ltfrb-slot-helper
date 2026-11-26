-- ============================================================================
-- LTFRB Franchise Monitor — Multi-Tenant + Per-User Supabase Migration
-- Matches existing `public.websites(id uuid)` and `auth.users(id uuid)`:
--   1. All tables are prefixed with `ltfrb_` to avoid collisions.
--   2. Every table includes `website_id uuid not null references public.websites(id) on delete cascade`.
--   3. User-owned tables include `user_id uuid not null references auth.users(id) on delete cascade`.
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. Watch Rules: what franchise types & regions/provinces to watch
create table if not exists public.ltfrb_watch_rules (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  scope text not null check (scope in ('region', 'province')),
  franchise_type_code text not null,
  franchise_type_name text not null,
  region_code text,
  region_name text,
  province_code text,
  province_name text,
  min_remaining integer not null default 1 check (min_remaining >= 1),
  notify_email text not null,
  cooldown_minutes integer not null default 60 check (cooldown_minutes >= 0),
  notify_when_available boolean not null default true,
  notify_when_increased boolean not null default true,
  notify_when_decreased boolean not null default false,
  is_active boolean not null default true,
  auto_submit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_watch_rules_tenant_active
  on public.ltfrb_watch_rules (website_id, is_active);

create index if not exists idx_ltfrb_watch_rules_user
  on public.ltfrb_watch_rules (website_id, user_id, created_at desc);

-- 2. Slot Snapshots: latest & historical availability snapshots per tenant
create table if not exists public.ltfrb_slot_snapshots (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  checked_at timestamptz not null default now(),
  scope text not null check (scope in ('region', 'province')),
  slot_key text not null,
  franchise_type_code text not null,
  franchise_type_name text not null,
  region_code text,
  region_name text,
  province_code text,
  province_name text,
  total_slots integer not null default 0,
  remaining integer not null default 0,
  filed_application integer not null default 0,
  percentage numeric(7, 4) not null default 0
);

create index if not exists idx_ltfrb_slot_snapshots_lookup
  on public.ltfrb_slot_snapshots (website_id, scope, slot_key, checked_at desc);

create index if not exists idx_ltfrb_slot_snapshots_checked
  on public.ltfrb_slot_snapshots (website_id, checked_at desc);

-- 3. Cron / Check Runs: execution audit trail
create table if not exists public.ltfrb_cron_runs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  trigger_source text not null default 'cron' check (trigger_source in ('cron', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'error')),
  records_checked integer not null default 0,
  rules_matched integer not null default 0,
  alerts_sent integer not null default 0,
  error_message text
);

create index if not exists idx_ltfrb_cron_runs_tenant
  on public.ltfrb_cron_runs (website_id, started_at desc);

-- 4. Notification Logs: tracks sent emails & enforces cooldown/deduplication
create table if not exists public.ltfrb_notification_logs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  watch_rule_id uuid references public.ltfrb_watch_rules(id) on delete set null,
  slot_key text not null,
  recipient text not null,
  subject text not null,
  remaining_at_alert integer not null,
  status text not null check (status in ('sent', 'skipped', 'failed')),
  provider_id text,
  error_message text,
  sent_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_notification_logs_cooldown
  on public.ltfrb_notification_logs (website_id, watch_rule_id, slot_key, sent_at desc);

-- 5. LTFRB Accounts: encrypted credentials & cached session token
create table if not exists public.ltfrb_accounts (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_type text not null default 'operator' check (account_type in ('operator', 'tnc')),
  ltfrb_email text not null,
  encrypted_password text not null,
  encrypted_token text,
  token_expires_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, user_id, account_type, ltfrb_email)
);

-- 6. Application Profiles: pre-filled application data + atomic submission lock
create table if not exists public.ltfrb_application_profiles (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.ltfrb_accounts(id) on delete cascade,
  watch_rule_id uuid references public.ltfrb_watch_rules(id) on delete set null,
  profile_name text not null,
  franchise_type_code text not null,
  region_id text not null,
  region_name text not null,
  province_id text,
  province_name text,
  route_id text,
  route_name text,
  number_of_units integer not null default 1 check (number_of_units >= 1),
  is_fleet boolean not null default false,
  units jsonb not null default '[]'::jsonb,
  custom_documents jsonb not null default '{}'::jsonb,
  notify_email text,
  lock_status text not null default 'idle' check (lock_status in ('idle', 'submitting', 'submitted')),
  is_armed boolean not null default false,
  submit_on_slot_increase boolean not null default true,
  submit_at_midnight boolean not null default false,
  submit_hourly boolean not null default false,
  submitted_reference text,
  last_error text,
  last_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_application_profiles_tenant
  on public.ltfrb_application_profiles (website_id, is_armed, lock_status);

create index if not exists idx_ltfrb_application_profiles_user
  on public.ltfrb_application_profiles (website_id, user_id, created_at desc);

-- 7. Submission Logs: audit trail of reservation attempts
create table if not exists public.ltfrb_submission_logs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  application_profile_id uuid references public.ltfrb_application_profiles(id) on delete cascade,
  watch_rule_id uuid references public.ltfrb_watch_rules(id) on delete set null,
  attempted_at timestamptz not null default now(),
  http_status integer,
  result text not null check (result in ('success', 'full_slot', 'auth_error', 'validation_error', 'network_error')),
  reference_number text,
  message text,
  raw_response jsonb
);

-- 8. User Preferences: up to 2 franchise types monitored per user account
create table if not exists public.ltfrb_user_preferences (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  monitored_franchise_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_ltfrb_max_two_franchises check (cardinality(monitored_franchise_codes) <= 2),
  unique (website_id, user_id)
);

-- ============================================================================
-- Row-Level Security (RLS)
-- All Next.js server routes use SUPABASE_SERVICE_ROLE_KEY and filter by WEBSITE_ID & user_id.
-- Enabling RLS blocks accidental anonymous/client-side access to tenant data.
-- ============================================================================
alter table public.ltfrb_watch_rules enable row level security;
alter table public.ltfrb_slot_snapshots enable row level security;
alter table public.ltfrb_cron_runs enable row level security;
alter table public.ltfrb_notification_logs enable row level security;
alter table public.ltfrb_accounts enable row level security;
alter table public.ltfrb_application_profiles enable row level security;
alter table public.ltfrb_submission_logs enable row level security;
alter table public.ltfrb_user_preferences enable row level security;
