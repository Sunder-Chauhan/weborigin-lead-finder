-- WebOrigin Lead Finder: initial schema.
-- Run in Supabase SQL Editor after reviewing this migration.
create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  linkedin_url text,
  full_name text not null default '',
  job_title text not null default '',
  company_name text not null default '',
  company_domain text not null default '',
  industry text not null default '',
  location text not null default '',
  status text not null default 'New'
    check (status in ('New', 'Contacted', 'Interested', 'Converted')),
  record_source text not null default 'Manual entry',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_user_linkedin_url_unique
  on public.leads (user_id, lower(linkedin_url))
  where linkedin_url is not null and linkedin_url <> '';
create index if not exists leads_user_created_at_idx
  on public.leads (user_id, created_at desc);

create table if not exists public.contact_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  contact_type text not null check (contact_type in ('email', 'phone')),
  value text not null,
  label text not null default 'professional',
  source_name text not null,
  source_url text,
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'syntax_valid', 'domain_valid', 'provider_verified', 'invalid')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists contact_points_deduplicate_idx
  on public.contact_points (lead_id, contact_type, lower(value));
create index if not exists contact_points_user_type_idx
  on public.contact_points (user_id, contact_type);

create table if not exists public.lookup_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  profile_url text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'partial', 'not_found', 'failed')),
  sources_attempted jsonb not null default '[]'::jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists lookup_jobs_user_created_idx
  on public.lookup_jobs (user_id, created_at desc);

-- Provider usage is read-only to ordinary clients; increment it from trusted server code.
create table if not exists public.provider_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_key text not null,
  period_start date not null,
  lookup_count integer not null default 0 check (lookup_count >= 0),
  quota integer check (quota is null or quota >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, provider_key, period_start)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  entity_type text not null default 'lead',
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user_created_idx
  on public.audit_events (user_id, created_at desc);

alter table public.leads enable row level security;
alter table public.contact_points enable row level security;
alter table public.lookup_jobs enable row level security;
alter table public.provider_usage enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "users manage their own leads" on public.leads;
create policy "users manage their own leads" on public.leads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users manage their own contact points" on public.contact_points;
create policy "users manage their own contact points" on public.contact_points
  for all using (auth.uid() = user_id) with check (
    auth.uid() = user_id and exists (
      select 1 from public.leads
      where leads.id = contact_points.lead_id and leads.user_id = auth.uid()
    )
  );

drop policy if exists "users manage their own lookup jobs" on public.lookup_jobs;
create policy "users manage their own lookup jobs" on public.lookup_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users read their own provider usage" on public.provider_usage;
create policy "users read their own provider usage" on public.provider_usage
  for select using (auth.uid() = user_id);

drop policy if exists "users read their own audit events" on public.audit_events;
create policy "users read their own audit events" on public.audit_events
  for select using (auth.uid() = user_id);

-- Note: ordinary clients do not receive provider_usage or audit_events write policies.
-- Trusted server-side code should use a server-only secret when updating these tables.
