-- The database decides what an invoice costs and what it says.
--
-- Found 19 October 2026, in an audit of the practitioner web app. Three ways
-- round the fee and the particulars a certificate is issued on:
--
--   1. create_transaction took the professional fee from the caller. It
--      checked the branch's 2% against that fee, but never the fee against
--      Scale 4, so a direct RPC call could invoice a ₦500m assignment at ₦1
--      and still be certified as compliant with the Order.
--   2. A direct POST to /rest/v1/transactions skipped create_transaction
--      altogether: no subscription, activation, membership or bank details
--      check, no invoice number, and an amount_payable nobody checked. No
--      client uses that route.
--   3. Once an invoice was drawn, its owner could still change the
--      consideration, document type and parties while it awaited payment or
--      sat rejected. The fee stayed as drawn, so the certificate could carry
--      an amount the fee was never charged on. proof_url took any string.
--
-- What changes:
--
--   * professional_fee_for() computes Scale 4 in SQL. It is the third copy of
--     the scale, after mobile/lib/fees/scale-2023.ts (the source of truth) and
--     the web app's lib/fees/legal-fees.ts; change all three together.
--   * create_transaction refuses a fee more than one kobo away from it, and
--     stores the server's figure. The kobo is mobile's: it rounds a floating
--     point sum, which can land a kobo away at a half.
--   * create_transaction also refuses while the member's branch has not
--     published its bank details. Awka had none on the day, and its members'
--     invoices told clients to pay an account that did not exist.
--   * enforce_transaction_insert refuses every insert that does not come
--     through create_transaction or a privileged actor.
--   * enforce_transaction_update lets the owner change proof_url and status
--     only, and proof_url only to a file under that transaction's own name:
--     {user_id}/{id}.{ext} (mobile) or {user_id}/{id}/{file} (web).

-- ---------------------------------------------------------------------------
-- Scale 4
-- ---------------------------------------------------------------------------

create or replace function public.professional_fee_for(
  p_document_type public.document_type,
  p_amount bigint
)
returns bigint
language plpgsql
immutable
set search_path = public
as $$
declare
  -- {min, max, percent} in kobo; a null max is the open top band.
  v_bands bigint[];
  v_band bigint[];
  v_upper bigint;
  v_hundredths bigint := 0;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'The amount cannot be negative.' using errcode = '22023';
  end if;
  -- ₦1,000,000,000,000, the clients' MAX_AMOUNT_KOBO.
  if p_amount > 100000000000000 then
    raise exception 'The amount is larger than the calculator accepts.' using errcode = '22023';
  end if;

  v_bands := case
    -- 4A, conveyancing and assignments.
    when p_document_type in ('deed_of_assignment', 'deed_of_conveyance', 'deed_of_gift',
                             'contract_of_sale', 'deed_of_surrender', 'deed_of_exchange') then
      array[[0, 5000000000, 10], [5000000000, 10000000000, 5], [10000000000, null, 3]]
    -- 4B, mortgages.
    when p_document_type in ('mortgage_deed', 'deed_of_release') then
      array[[0, 5000000000, 4], [5000000000, 10000000000, 3], [10000000000, null, 2]]
    -- 4C, leases and tenancies, on annual rent. The inert ₦10m boundary is
    -- mobile's, marked SUSPECT there; reproduced so the figures agree.
    when p_document_type in ('tenancy_agreement', 'deed_of_lease', 'deed_of_sub_lease') then
      array[[0, 500000000, 10], [500000000, 1000000000, 5], [1000000000, null, 5]]
  end;

  if v_bands is null then
    raise exception 'This document is not covered by Scale 4. The fee is agreed with the client under paragraph 2 of the Order.'
      using errcode = '22023';
  end if;

  -- Marginal bands, summed exactly in hundredths of a kobo, rounded once,
  -- half up: the web engine's method, which mobile's float sum approximates.
  foreach v_band slice 1 in array v_bands loop
    continue when p_amount <= v_band[1];
    v_upper := case when v_band[2] is null or p_amount < v_band[2] then p_amount else v_band[2] end;
    v_hundredths := v_hundredths + (v_upper - v_band[1]) * v_band[3];
  end loop;

  return (v_hundredths + 50) / 100;
end;
$$;

revoke execute on function public.professional_fee_for(public.document_type, bigint) from public, anon;
grant execute on function public.professional_fee_for(public.document_type, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_transaction, reproduced from 20261017100000
-- ---------------------------------------------------------------------------

create or replace function public.create_transaction(
  p_document_type public.document_type,
  p_consideration bigint,
  p_professional_fee bigint,
  p_branch_fee bigint,
  p_parties text,
  p_breakdown jsonb default '{}'::jsonb
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

  -- CHANGED. The invoice tells the client to pay into the branch's account;
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
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;
  if p_branch_fee <> public.branch_fee_for(p_professional_fee) then
    raise exception 'The branch fee does not match the professional fee' using errcode = '23514';
  end if;

  -- CHANGED. The fee is the scale's, not the caller's. One kobo either way is
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
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, branch_fee, invoice_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, v_fee, public.branch_fee_for(v_fee), v_invoice, 'awaiting_payment'
  )
  returning id into v_txn_id;

  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- enforce_transaction_insert, reproduced from 20260929100000
-- ---------------------------------------------------------------------------

create or replace function public.enforce_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  -- CHANGED. Was: a direct insert went through with its branch fee and
  -- status reset. It skipped every check create_transaction makes, and no
  -- client uses it, so it is refused.
  if coalesce(current_setting('app.issuing_receipt', true), '') <> 'on' then
    raise exception 'Transactions are created through create_transaction' using errcode = '42501';
  end if;

  new.remitted_at := null;
  new.remitted_by := null;
  new.remittance_reference := null;
  new.remitted_to := null;
  new.status := 'awaiting_payment';
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.rbin := null;
  new.rbin_issued_at := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- enforce_transaction_update, reproduced from 20260929100000
-- ---------------------------------------------------------------------------

create or replace function public.enforce_transaction_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_proof_prefix text;
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  -- Set only by issue_rbin(), transaction-local, unreachable from a client.
  if coalesce(current_setting('app.issuing_rbin', true), '') = 'on' then
    return new;
  end if;

  -- Set only by record_remittance(), on the same terms.
  if coalesce(current_setting('app.recording_remittance', true), '') = 'on' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.branch_id is distinct from old.branch_id
     or new.calculation_id is distinct from old.calculation_id
     or new.amount_payable is distinct from old.amount_payable
     or new.branch_fee is distinct from old.branch_fee
     or new.remitted_at is distinct from old.remitted_at
     or new.remitted_by is distinct from old.remitted_by
     or new.remittance_reference is distinct from old.remittance_reference
     or new.remitted_to is distinct from old.remitted_to
     or new.invoice_number is distinct from old.invoice_number
     or new.rbin is distinct from old.rbin
     or new.rbin_issued_at is distinct from old.rbin_issued_at then
    raise exception 'this field is managed by the server' using errcode = '42501';
  end if;

  if v_actor = old.user_id then
    if old.status not in ('awaiting_payment', 'rejected') then
      raise exception 'transaction can no longer be edited' using errcode = '42501';
    end if;
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at then
      raise exception 'this field is managed by the server' using errcode = '42501';
    end if;
    -- CHANGED. The particulars are what the fee was charged on and what the
    -- certificate prints, so they stand as drawn. The rejection reason is
    -- the branch's, cleared below on resubmission.
    if new.parties is distinct from old.parties
       or new.document_type is distinct from old.document_type
       or new.consideration is distinct from old.consideration
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'an invoice''s particulars cannot be changed once it is drawn' using errcode = '42501';
    end if;
    -- CHANGED. A proof is a file under this transaction's own name.
    if new.proof_url is distinct from old.proof_url then
      v_proof_prefix := old.user_id::text || '/' || old.id::text;
      if new.proof_url is null
         or position('..' in new.proof_url) > 0
         or left(new.proof_url, length(v_proof_prefix) + 1)
              not in (v_proof_prefix || '.', v_proof_prefix || '/') then
        raise exception 'proof of payment must be a file uploaded for this transaction' using errcode = '42501';
      end if;
    end if;
    if new.status = old.status then
      return new;
    end if;
    if new.status = 'pending_verification' then
      if new.proof_url is null then
        raise exception 'proof of payment is required before submission' using errcode = '23514';
      end if;
      new.rejection_reason := null;
      return new;
    end if;
    raise exception 'invalid status transition' using errcode = '42501';
  end if;

  if v_role = 'branch_admin' and old.branch_id = public.current_user_branch() then
    if old.status <> 'pending_verification'
       or new.status not in ('verified', 'rejected') then
      raise exception 'invalid status transition' using errcode = '42501';
    end if;
    if new.parties is distinct from old.parties
       or new.document_type is distinct from old.document_type
       or new.consideration is distinct from old.consideration
       or new.proof_url is distinct from old.proof_url then
      raise exception 'verifiers cannot alter transaction details' using errcode = '42501';
    end if;
    if new.status = 'rejected' and nullif(trim(new.rejection_reason), '') is null then
      raise exception 'a reason is required when rejecting' using errcode = '23514';
    end if;
    new.verified_by := v_actor;
    new.verified_at := now();
    return new;
  end if;

  raise exception 'you may not modify this transaction' using errcode = '42501';
end;
$$;
