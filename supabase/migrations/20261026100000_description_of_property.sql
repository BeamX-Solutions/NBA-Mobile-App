-- A land invoice says what land it is for.
--
-- Raised 26 October 2026 by two branch chairmen: the invoice names the
-- parties and the instrument, but not the property, so nothing on it ties
-- the fee to a particular piece of land.
--
-- What changes:
--
--   * transactions.property_description holds the practitioner's
--     description of the land (location, plot or survey number, size). It is
--     null on every invoice drawn before today.
--   * create_transaction takes it as p_property_description. The parameter
--     defaults to null so the mobile app, which does not send it yet, keeps
--     working; the web app requires it. Make it required here once mobile
--     collects it too.
--   * Like the parties, it stands as drawn. enforce_transaction_update
--     predates it, so a separate guard refuses a change, rather than another
--     copy of that function.

alter table public.transactions
  add column property_description text
    constraint transactions_property_description_length
    check (property_description is null or char_length(trim(property_description)) between 1 and 500);

comment on column public.transactions.property_description is
  'The land the instrument deals with, as the practitioner described it on the invoice. Null on invoices drawn before 26 October 2026. Set only by create_transaction.';

-- ---------------------------------------------------------------------------
-- create_transaction, reproduced from 20261019110000 with the description
-- ---------------------------------------------------------------------------

-- A new parameter is a new signature, so the old one goes rather than
-- leaving an overload behind.
drop function if exists public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb);

create function public.create_transaction(
  p_document_type public.document_type,
  p_consideration bigint,
  p_professional_fee bigint,
  p_branch_fee bigint,
  p_parties text,
  p_breakdown jsonb default '{}'::jsonb,
  p_property_description text default null
)
returns table (transaction_id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_branch public.branches%rowtype;
  v_scale_id uuid;
  v_calculation_id uuid;
  v_invoice text;
  v_txn_id uuid;
  v_parties text := nullif(trim(p_parties), '');
  v_property_description text := nullif(trim(p_property_description), '');
  v_fee bigint;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.role = 'super_admin' then
    raise exception 'A super administrator account belongs to no branch and cannot submit transactions.'
      using errcode = '42501';
  end if;

  if v_profile.membership_status <> 'approved' then
    raise exception 'Your branch has not approved your membership yet, so you cannot generate an invoice.'
      using errcode = 'P0001';
  end if;

  if v_profile.branch_id is null then
    raise exception 'You are not affiliated with a branch. Request affiliation from Edit Profile before generating an invoice.'
      using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = v_profile.branch_id;
  if not found then
    raise exception 'Your branch could not be found' using errcode = 'P0002';
  end if;

  if not public.branch_is_active(v_profile.branch_id) then
    raise exception
      '% is not currently active, so invoices cannot be generated for it. Your branch must renew its activation with the Association. Calculations remain free.',
      v_branch.name
      using errcode = 'P0001';
  end if;

  -- The invoice tells the client to pay into the branch's account;
  -- with no account to name, it would send them nowhere.
  if nullif(trim(v_branch.account_name), '') is null
     or nullif(trim(v_branch.account_number), '') is null
     or nullif(trim(v_branch.bank_name), '') is null then
    raise exception
      '% has not published its bank details yet, so invoices cannot be generated for it. Ask your branch administrator to add them in Branch Records. Calculations remain free.',
      v_branch.name
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'An active subscription is required to generate an invoice. Calculations remain free.'
      using errcode = 'P0001';
  end if;

  if nullif(trim(v_profile.bank_account_name), '') is null
     or v_profile.bank_account_number is null
     or nullif(trim(v_profile.bank_name), '') is null then
    raise exception 'Add your bank details in Edit Profile before generating an invoice. Your branch sends your fee to that account.'
      using errcode = 'P0001';
  end if;

  if v_parties is null then
    raise exception 'Name the parties to the document' using errcode = '23514';
  end if;
  -- CHANGED. Optional here so a client that does not send it yet still works;
  -- the web app requires it.
  if char_length(v_property_description) > 500 then
    raise exception 'The description of the property must be 500 characters or fewer' using errcode = '23514';
  end if;
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;
  if p_branch_fee <> public.branch_fee_for(p_professional_fee) then
    raise exception 'The branch fee does not match the professional fee' using errcode = '23514';
  end if;

  -- The fee is the scale's, not the caller's. One kobo either way is
  -- mobile's rounding; anything more is a different figure.
  v_fee := public.professional_fee_for(p_document_type, p_consideration);
  if abs(p_professional_fee - v_fee) > 1 then
    raise exception 'The fee does not match Scale 4 for this amount. Recalculate and try again.'
      using errcode = '23514';
  end if;

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  if v_scale_id is not null then
    insert into public.calculations (
      user_id, fee_scale_id, document_type, consideration,
      professional_fee, branch_fee, breakdown
    )
    values (
      v_actor, v_scale_id, p_document_type, p_consideration,
      v_fee, public.branch_fee_for(v_fee),
      coalesce(p_breakdown, '{}'::jsonb)
    )
    returning id into v_calculation_id;
  end if;

  v_invoice := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  perform set_config('app.issuing_receipt', 'on', true);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, property_description, document_type,
    consideration, amount_payable, branch_fee, invoice_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, v_property_description, p_document_type,
    p_consideration, v_fee, public.branch_fee_for(v_fee), v_invoice, 'awaiting_payment'
  )
  returning id into v_txn_id;

  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_invoice;
end;
$$;

revoke execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb, text) from public, anon;
grant execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The description stands as drawn
-- ---------------------------------------------------------------------------

create or replace function public.guard_transaction_property_description()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if new.property_description is distinct from old.property_description then
    raise exception 'an invoice''s particulars cannot be changed once it is drawn' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_transaction_property_description
  before update on public.transactions
  for each row execute function public.guard_transaction_property_description();
