-- Invoice numbers carry the branch's short code: TXN-AN-00017-DOA.
--
-- Until now an invoice number was TXN- + a counter + the document code, with
-- the counter kept per branch and restarted every January, while the column
-- is unique across the whole system. Only Anaocha had ever invoiced, so the
-- two never met. The demo branch (20261120100000) was the second branch to
-- invoice and took TXN-00001-DOA, after which the first Deed of Assignment at
-- any other branch would have been refused as a duplicate; every pgTAP suite
-- that draws an invoice in a fresh branch started failing on the hosted
-- database, which is how it was found (2026-11-23). The same clash awaited
-- any two branches at the same count, and every branch each new year.
--
-- New invoices are TXN-<short code>-<counter>-<document code>:
--
--   * short_code is unique and non-empty per branch (constraints on branches),
--     so two branches can never produce the same number;
--   * the counter is per branch and never restarts, so a branch never repeats
--     a number in a later year;
--   * each branch's counter starts where its old one stood this year, so
--     Anaocha's next invoice is TXN-AN-00017-..., continuing its count.
--
-- Existing invoices keep their numbers; old and new formats cannot collide
-- because the new one always has the branch code. Nothing in the clients
-- parses the format.

-- Carry each branch's count forward into its new, never-restarting counter.
insert into public.number_sequences (scope, last_value)
select 'invoice:' || b.id::text, max(ns.last_value)
from public.branches b
join public.number_sequences ns
  on ns.scope = 'receipt:' || b.branch_code || ':' || extract(year from now())::text
group by b.id
on conflict (scope) do nothing;

-- create_transaction, reproduced from the live definition with only the
-- invoice number changed.
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
