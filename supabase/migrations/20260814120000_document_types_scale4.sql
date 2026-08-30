-- Replace the document_type enum with the set actually used by the NBA
-- Remuneration Portal, and drop the State Band model.
--
-- Two corrections, both established by reading the portal's implementation
-- (nba-remuneration-portal/src/lib/constants.ts), which is the version in use:
--
--   1. Scale 4 is three sub-scales with different rates AND different bases:
--      4A conveyancing (on consideration), 4B mortgages (on the loan), and
--      4C leases (on ANNUAL RENT). The earlier single-table model could not
--      express that.
--
--   2. There is no State Band. Fees do not vary by state. The state_bands
--      table and the fee_scale_bands.state_band column both go.
--
-- Irrevocable Power of Attorney is retained as a document type even though it
-- has no computable fee: it is a real instrument a practitioner prepares, and
-- the app explains that its fee is agreed under paragraph 2 of the Order.

-- ---------------------------------------------------------------------------
-- document_type: rename the old enum and build the new one
-- ---------------------------------------------------------------------------

alter type public.document_type rename to document_type_old;

create type public.document_type as enum (
  'deed_of_assignment',
  'deed_of_conveyance',
  'deed_of_gift',
  'contract_of_sale',
  'deed_of_surrender',
  'deed_of_exchange',
  'mortgage_deed',
  'deed_of_release',
  'tenancy_agreement',
  'deed_of_lease',
  'deed_of_sub_lease',
  'power_of_attorney'
);

-- Map the old values onto the new ones. The old 'lease' covered both leases
-- and tenancies; it maps to tenancy_agreement, which is the commoner
-- instrument and shares the same 4C scale, so no fee changes as a result.
--
-- The mapping is inlined in each USING clause rather than factored into a
-- helper function. A function taking document_type_old as a parameter becomes
-- a dependant of that type, which then blocks the DROP TYPE below.
do $$
declare
  mapping constant text := $map$
    case document_type::text
      when 'assignment'        then 'deed_of_assignment'
      when 'conveyance'        then 'deed_of_conveyance'
      when 'mortgage'          then 'mortgage_deed'
      when 'lease'             then 'tenancy_agreement'
      when 'sublease'          then 'deed_of_sub_lease'
      when 'deed_of_gift'      then 'deed_of_gift'
      when 'power_of_attorney' then 'power_of_attorney'
    end::public.document_type
  $map$;
  target text;
begin
  foreach target in array array['calculations', 'transactions', 'fee_scale_bands']
  loop
    execute format(
      'alter table public.%I alter column document_type type public.document_type using %s',
      target, mapping
    );
  end loop;
end;
$$;

drop type public.document_type_old;

-- ---------------------------------------------------------------------------
-- Drop the State Band model
-- ---------------------------------------------------------------------------

drop index if exists public.fee_scale_bands_lookup_idx;

alter table public.fee_scale_bands drop column if exists state_band;

-- Sub-scale of Scale 4 the band belongs to. Replaces the state_band axis.
create type public.fee_sub_scale as enum ('4A', '4B', '4C');

alter table public.fee_scale_bands
  add column if not exists sub_scale public.fee_sub_scale;

create index fee_scale_bands_lookup_idx
  on public.fee_scale_bands (fee_scale_id, sub_scale, min_consideration);

-- practice_state stays on profiles: it records where a practitioner works,
-- which is useful for branch administration. It no longer affects any fee, so
-- the foreign key to state_bands is dropped before that table goes.
alter table public.profiles
  drop constraint if exists profiles_practice_state_fkey;

drop table if exists public.state_bands;
