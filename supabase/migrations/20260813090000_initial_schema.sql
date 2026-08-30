-- Phase 1: core schema for the NBA Fee Calculator platform.
-- All money columns are integer kobo (bigint). All timestamps are timestamptz.
-- See SPEC.md sections 4 and 5.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

create type public.branch_activation_status as enum ('inactive', 'active', 'expired');

create type public.user_role as enum ('individual', 'branch_member', 'branch_admin', 'super_admin');

create type public.subscription_plan as enum ('weekly', 'monthly', 'quarterly', 'yearly');

create type public.subscription_rate_type as enum ('standard', 'branch_discounted');

create type public.subscription_status as enum ('active', 'expired', 'cancelled');

create type public.transaction_status as enum ('awaiting_payment', 'pending_verification', 'verified', 'rejected');

-- Candidate Scale 4 document types. Extend with ALTER TYPE once the client
-- confirms the covered instruments (SPEC.md section 10).
create type public.document_type as enum (
  'assignment',
  'conveyance',
  'mortgage',
  'lease',
  'sublease',
  'deed_of_gift',
  'power_of_attorney'
);

-- ---------------------------------------------------------------------------
-- state_bands: mapping of the 36 states plus FCT to the Order's State Bands
-- ---------------------------------------------------------------------------

create table public.state_bands (
  state text primary key,
  band smallint not null check (band between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  branch_code text not null unique check (branch_code = upper(branch_code) and branch_code <> ''),
  activation_status public.branch_activation_status not null default 'inactive',
  activated_at timestamptz,
  expires_at timestamptz,
  account_name text,
  account_number text,
  bank_name text,
  logo_url text,
  chairman_name text,
  chairman_signature_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, created by trigger on auth.users
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  phone text,
  scn text unique,
  branch_id uuid references public.branches (id),
  practice_state text references public.state_bands (state),
  role public.user_role not null default 'individual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_branch_id_idx on public.profiles (branch_id);

-- ---------------------------------------------------------------------------
-- fee_scales and fee_scale_bands: versioned rules of the Remuneration Order
-- ---------------------------------------------------------------------------

create table public.fee_scales (
  id uuid primary key default gen_random_uuid(),
  order_name text not null,
  effective_from date not null,
  effective_to date,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active scale at a time.
create unique index fee_scales_one_active_idx on public.fee_scales (is_active) where is_active;

create table public.fee_scale_bands (
  id uuid primary key default gen_random_uuid(),
  fee_scale_id uuid not null references public.fee_scales (id) on delete cascade,
  scale_number smallint not null check (scale_number between 1 and 5),
  state_band smallint not null check (state_band between 1 and 3),
  document_type public.document_type not null,
  min_consideration bigint not null check (min_consideration >= 0),
  max_consideration bigint check (max_consideration > min_consideration),
  percentage numeric(6, 3) check (percentage >= 0),
  flat_amount bigint check (flat_amount >= 0),
  branch_share_percentage numeric(6, 3) check (branch_share_percentage >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (percentage is not null or flat_amount is not null)
);

create index fee_scale_bands_lookup_idx
  on public.fee_scale_bands (fee_scale_id, scale_number, state_band, document_type, min_consideration);

-- ---------------------------------------------------------------------------
-- subscriptions: written only by the server (Paystack webhook), never clients
-- ---------------------------------------------------------------------------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  plan public.subscription_plan not null,
  rate_type public.subscription_rate_type not null,
  amount bigint not null check (amount >= 0),
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  status public.subscription_status not null default 'active',
  paystack_reference text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create index subscriptions_user_idx on public.subscriptions (user_id, status);

-- One active subscription per user at a time.
create unique index subscriptions_one_active_idx on public.subscriptions (user_id) where status = 'active';

-- ---------------------------------------------------------------------------
-- calculations: free tier, snapshot of a fee calculation
-- ---------------------------------------------------------------------------

create table public.calculations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  fee_scale_id uuid not null references public.fee_scales (id),
  document_type public.document_type not null,
  consideration bigint not null check (consideration >= 0),
  professional_fee bigint not null check (professional_fee >= 0),
  branch_fee bigint not null check (branch_fee >= 0),
  total bigint not null check (total >= 0),
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calculations_user_idx on public.calculations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- transactions: a receipt plus the proof-of-payment and verification lifecycle
-- ---------------------------------------------------------------------------

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  branch_id uuid not null references public.branches (id),
  calculation_id uuid references public.calculations (id),
  parties text not null,
  document_type public.document_type not null,
  consideration bigint not null check (consideration >= 0),
  amount_payable bigint not null check (amount_payable >= 0),
  receipt_number text unique,
  proof_url text,
  status public.transaction_status not null default 'awaiting_payment',
  rejection_reason text,
  verified_by uuid references public.profiles (id),
  verified_at timestamptz,
  bain text unique,
  bain_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_user_idx on public.transactions (user_id, created_at desc);
create index transactions_branch_status_idx on public.transactions (branch_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- certificates
-- ---------------------------------------------------------------------------

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id),
  certificate_number text not null unique,
  issued_at timestamptz not null default now(),
  pdf_url text,
  emailed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- audit_log: quasi-legal record of every state change that matters
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- number_sequences: gapless per-scope counters for BAIN, receipt and
-- certificate numbers. Callers take a row lock via the upsert, so concurrent
-- issuance serialises and the sequence cannot gap or collide. Used by
-- server-side functions only (Phases 4 and 6).
-- ---------------------------------------------------------------------------

create table public.number_sequences (
  scope text primary key,
  last_value bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
