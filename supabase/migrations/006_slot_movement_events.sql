-- ============================================================================
-- Migration 006: Slot Movement Events (Refills, Increases, Decreases) & Timing Analytics
-- ============================================================================

create table if not exists public.ltfrb_slot_events (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  manila_hour integer not null check (manila_hour >= 0 and manila_hour <= 23),
  manila_weekday integer not null check (manila_weekday >= 0 and manila_weekday <= 6),
  scope text not null check (scope in ('region', 'province')),
  slot_key text not null,
  franchise_type_code text not null,
  franchise_type_name text not null,
  region_code text,
  region_name text,
  province_code text,
  province_name text,
  event_type text not null check (event_type in ('refilled', 'increased', 'decreased')),
  previous_remaining integer not null,
  new_remaining integer not null,
  delta integer not null
);

create index if not exists idx_ltfrb_slot_events_tenant_time
  on public.ltfrb_slot_events (website_id, occurred_at desc);

create index if not exists idx_ltfrb_slot_events_tenant_franchise
  on public.ltfrb_slot_events (website_id, franchise_type_code, occurred_at desc);

alter table public.ltfrb_slot_events enable row level security;
