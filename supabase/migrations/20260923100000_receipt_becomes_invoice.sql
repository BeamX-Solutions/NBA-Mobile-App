-- The document issued before payment is an invoice, not a receipt.
--
-- A receipt acknowledges money already received. This document does the
-- opposite: it is drawn when a practitioner has calculated a fee and not yet
-- paid anything, it names the branch's account, it carries the reference to
-- quote on the transfer, and it asks the practitioner to upload their slip
-- afterwards. That is an invoice in every respect except its name.
--
-- The name mattered more than a label usually does. A practitioner who has
-- been handed something called a receipt has been told, in the ordinary
-- meaning of the word, that their payment is settled. Here it means the
-- transaction has not been paid for at all, and the certificate that depends
-- on the payment cannot be issued until it is.
--
-- WHO IS BILLING WHOM. The branch bills the practitioner for the branch fee.
-- An earlier comment on the template claimed the document was "issued to the
-- client" and hid the branch's share on that basis, while the same page
-- printed the branch's bank account and told the practitioner to upload their
-- own payment slip. Those cannot both be true. It is the branch's invoice to
-- its member, and it now says so.
--
-- The column is renamed rather than left alone. A database that says receipt
-- while every screen says invoice is a discrepancy that outlives whoever knew
-- about it.
--
-- WHAT IS NOT CHANGED. The reference format stays TXN-00001-DOA. It is printed
-- on documents practitioners already hold and quoted on transfers that have
-- already been made, and the sequence it is drawn from is per branch per year.
-- Rewriting it would orphan every payment reference in circulation to make a
-- prefix match a word. TXN is neutral between the two readings in any case.

alter table public.transactions
  rename column receipt_number to invoice_number;

comment on column public.transactions.invoice_number is
  'The branch invoice reference, TXN-00001-DOA. Drawn when the transaction is created, before any payment, and quoted by the practitioner on their transfer.';

-- ---------------------------------------------------------------------------
-- create_transaction
-- ---------------------------------------------------------------------------
--
-- Recreated whole from 20260922100000, with receipt_number renamed throughout
-- and the returned column renamed with it. The app reads that name, so leaving
-- it would mean the rename stopped at the table.
--
-- app.issuing_receipt keeps its name. It is a transaction-local setting read
-- by enforce_transaction_insert, never stored, never displayed and never
-- reachable from a client, so renaming it would mean changing two functions in
-- lockstep for no visible gain.

-- Dropped rather than replaced. Renaming an output column changes the
-- function's return type, and create or replace refuses that: "cannot change
-- return type of existing function". The grant goes with the drop, so it is
-- reissued below.
drop function if exists public.create_transaction(
  public.document_type, bigint, bigint, bigint, text, jsonb
);

create function public.create_transaction(
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
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.role in ('branch_admin', 'super_admin') then
    raise exception 'Administrator accounts cannot submit transactions. Use a practitioner account.'
      using errcode = '42501';
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

  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'An active subscription is required to generate an invoice. Calculations remain free.'
      using errcode = 'P0001';
  end if;

  if v_parties is null then
    raise exception 'Name the parties to the document' using errcode = '23514';
  end if;
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  if v_scale_id is not null then
    insert into public.calculations (
      user_id, fee_scale_id, document_type, consideration,
      professional_fee, branch_fee, total, breakdown
    )
    values (
      v_actor, v_scale_id, p_document_type, p_consideration,
      p_professional_fee, p_branch_fee, p_professional_fee + p_branch_fee,
      coalesce(p_breakdown, '{}'::jsonb)
    )
    returning id into v_calculation_id;
  end if;

  -- Drawn before the marker is raised: consuming a sequence value is the part
  -- that must not happen twice, and it is unrelated to the insert path.
  v_invoice := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  perform set_config('app.issuing_receipt', 'on', true);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, invoice_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, p_branch_fee, v_invoice, 'awaiting_payment'
  )
  returning id into v_txn_id;

  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_invoice;
end;
$$;

grant execute on function public.create_transaction(
  public.document_type, bigint, bigint, bigint, text, jsonb
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The triggers that name the column
-- ---------------------------------------------------------------------------
--
-- enforce_transaction_insert and enforce_transaction_update both reference the
-- column by name, so renaming it underneath them would leave every write to a
-- transaction failing with 42703. Both are reproduced here from their live
-- definitions with the name changed and nothing else, rather than retyped:
-- these are the functions that decide what a client may do to a transaction,
-- and a transcription slip in one of them is a security change made by
-- accident.

-- enforce_transaction_insert: regenerated from the live definition with the column
-- renamed and nothing else touched.
CREATE OR REPLACE FUNCTION public.enforce_transaction_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if coalesce(current_setting('app.issuing_receipt', true), '') = 'on' then
    new.status := 'awaiting_payment';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.rbin := null;
    new.rbin_issued_at := null;
    return new;
  end if;

  new.status := 'awaiting_payment';
  new.invoice_number := null;
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.rbin := null;
  new.rbin_issued_at := null;
  return new;
end;
$function$;

-- enforce_transaction_update: regenerated from the live definition with the column
-- renamed and nothing else touched.
CREATE OR REPLACE FUNCTION public.enforce_transaction_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  -- Set only by issue_rbin(), transaction-local, unreachable from a client.
  if coalesce(current_setting('app.issuing_rbin', true), '') = 'on' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.branch_id is distinct from old.branch_id
     or new.calculation_id is distinct from old.calculation_id
     or new.amount_payable is distinct from old.amount_payable
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
$function$;
