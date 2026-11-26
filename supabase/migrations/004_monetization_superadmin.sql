-- ============================================================================
-- Migration 004: Monetization (1-Year Plan + Add-ons), GCash/Maya QR Payments & SuperAdmin
-- ============================================================================

-- 1. Drop hardcoded 2-franchise check constraint so alert slot add-ons scale cleanly
alter table if exists public.ltfrb_user_preferences
  drop constraint if exists chk_ltfrb_max_two_franchises;

-- 2. User Subscriptions & Add-On Quotas
create table if not exists public.ltfrb_subscriptions (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  plan_code text not null default 'free' check (plan_code in ('free', 'annual_1699')),
  status text not null default 'unpaid' check (status in ('unpaid', 'pending', 'active', 'expired')),
  is_disabled boolean not null default false,
  disabled_reason text,
  base_auto_reserve_limit integer not null default 1 check (base_auto_reserve_limit >= 1),
  extra_auto_reserve_slots integer not null default 0 check (extra_auto_reserve_slots >= 0),
  base_alert_slot_limit integer not null default 1 check (base_alert_slot_limit >= 1),
  extra_alert_slots integer not null default 0 check (extra_alert_slots >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, user_id)
);

create index if not exists idx_ltfrb_subscriptions_tenant_status
  on public.ltfrb_subscriptions (website_id, status, is_disabled);

-- 3. GCash / Maya QR Codes configured by SuperAdmin
create table if not exists public.ltfrb_payment_qr_codes (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  provider text not null default 'gcash' check (provider in ('gcash', 'maya', 'other')),
  title text not null,
  description text not null default '',
  image_url text not null,
  storage_path text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_payment_qr_tenant_active
  on public.ltfrb_payment_qr_codes (website_id, is_active, sort_order asc, created_at desc);

-- 4. User Payment & Add-On Requests submitted via GCash / Maya QR
create table if not exists public.ltfrb_payment_requests (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  qr_code_id uuid references public.ltfrb_payment_qr_codes(id) on delete set null,
  request_type text not null check (request_type in ('annual_plan', 'addon', 'bundle')),
  includes_annual_plan boolean not null default false,
  requested_extra_profiles integer not null default 0 check (requested_extra_profiles >= 0),
  requested_extra_alerts integer not null default 0 check (requested_extra_alerts >= 0),
  expected_amount_php integer not null check (expected_amount_php > 0),
  reference_number text not null,
  sender_name text,
  receipt_image_url text,
  receipt_storage_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by_email text,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_payment_requests_tenant_status
  on public.ltfrb_payment_requests (website_id, status, created_at desc);

create index if not exists idx_ltfrb_payment_requests_user
  on public.ltfrb_payment_requests (website_id, user_id, created_at desc);

-- 5. SuperAdmin Audit Log
create table if not exists public.ltfrb_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  admin_email text not null,
  target_user_id uuid,
  target_user_email text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ltfrb_admin_audit_logs_tenant
  on public.ltfrb_admin_audit_logs (website_id, created_at desc);

-- Enable RLS across all new tables (service_role bypasses; blocks anon client access)
alter table public.ltfrb_subscriptions enable row level security;
alter table public.ltfrb_payment_qr_codes enable row level security;
alter table public.ltfrb_payment_requests enable row level security;
alter table public.ltfrb_admin_audit_logs enable row level security;
