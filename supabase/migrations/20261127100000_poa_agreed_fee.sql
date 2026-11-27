-- Power of Attorney invoices at the fee agreed with the client.
--
-- A Power of Attorney is not a Scale 4 instrument: the Order leaves its fee to
-- paragraph 2, agreed with the client having regard to complexity, time and
-- value. Until now create_transaction refused it outright (professional_fee_for
-- raises), so no invoice, verification or certificate could exist for one.
--
-- What changes:
--
--   * branches.accepts_poa_invoices, off by default. A branch administrator
--     turns it on for their own branch in the console (the existing "branch
--     admin updates own branch" policy covers it; protect_branch_columns does
--     not list it). Nothing changes for a branch until it does.
--   * create_transaction takes the practitioner's agreed fee for a Power of
--     Attorney, where the branch accepts them: more than zero, no more than the
--     calculator's ₦1 trillion ceiling, with a consideration of 0 because no
--     value is assessed. The branch fee is its usual share of that fee. No
--     calculations row is written; there is nothing the scale computed.
--   * Every other document type is priced exactly as before.
--
-- The branch still verifies the payment before a certificate is issued, and
-- may reject the proof if the fee looks wrong. The clients mark the invoice
-- and certificate as an agreed fee under paragraph 2, never a Scale 4 fee.

alter table public.branches
  add column accepts_poa_invoices boolean not null default false;

comment on column public.branches.accepts_poa_invoices is
  'Whether practitioners of this branch may invoice an Irrevocable Power of Attorney at the fee agreed with the client (paragraph 2 of the Order). Set by the branch administrator; off by default.';

-- ---------------------------------------------------------------------------
-- create_transaction, reproduced from 20261123090000 with the fee changed
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_transaction(p_document_type document_type, p_consideration bigint, p_professional_fee bigint, p_branch_fee bigint, p_parties text, p_breakdown jsonb DEFAULT '{}'::jsonb, p_property_description text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, invoice_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if p_document_type = 'power_of_attorney' then
    -- CHANGED. A Power of Attorney has no scale: its fee is agreed with the
    -- client under paragraph 2 of the Order. The caller's figure is taken,
    -- but only where the branch has chosen to accept these invoices, and the
    -- branch still verifies the payment before any certificate.
    if not v_branch.accepts_poa_invoices then
      raise exception
        '% does not accept Power of Attorney invoices. Its fee is agreed with the client under paragraph 2 of the Order.',
        v_branch.name
        using errcode = 'P0001';
    end if;
    if p_professional_fee <= 0 then
      raise exception 'Enter the fee agreed with the client' using errcode = '23514';
    end if;
    -- ₦1,000,000,000,000, the clients' MAX_AMOUNT_KOBO.
    if p_professional_fee > 100000000000000 then
      raise exception 'The agreed fee is larger than the calculator accepts.' using errcode = '23514';
    end if;
    -- No value is assessed, so none is recorded: a figure here would read as
    -- a Scale 4 basis on the invoice and certificate.
    if p_consideration <> 0 then
      raise exception 'A Power of Attorney is invoiced on the agreed fee alone; send a consideration of 0'
        using errcode = '23514';
    end if;
    v_fee := p_professional_fee;
  else
    -- The fee is the scale's, not the caller's. One kobo either way is
    -- mobile's rounding; anything more is a different figure.
    v_fee := public.professional_fee_for(p_document_type, p_consideration);
    if abs(p_professional_fee - v_fee) > 1 then
      raise exception 'The fee does not match Scale 4 for this amount. Recalculate and try again.'
        using errcode = '23514';
    end if;

    select id into v_scale_id from public.fee_scales where is_active limit 1;
  end if;

  -- No calculation for an agreed fee: there is nothing the scale computed.
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

  -- The branch's short code makes the number unique across branches, and the
  -- counter never restarts, so it stays unique across years. See the header
  -- of 20261123090000_branch_coded_invoice_numbers.sql.
  v_invoice := 'TXN-' || v_branch.short_code || '-'
    || lpad(public.next_sequence_value('invoice:' || v_branch.id::text)::text, 5, '0')
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
$function$;

revoke execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb, text) from public, anon;
grant execute on function public.create_transaction(public.document_type, bigint, bigint, bigint, text, jsonb, text) to authenticated, service_role;
