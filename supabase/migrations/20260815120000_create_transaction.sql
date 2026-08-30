-- Starting a transaction: the missing first step of the pipeline.
--
-- Everything downstream (receipt, proof upload, verification, BAIN,
-- certificate) was reachable only if a transactions row existed, and nothing
-- created one. This is that entry point.
--
-- It is a database function rather than a client insert for three reasons:
--
--   1. receipt_number cannot be set by a client at all. The
--      enforce_transaction_insert trigger strips it, so a client-side insert
--      would always produce a transaction with no reference to quote on a
--      bank transfer.
--
--   2. The subscription check has to be server side. A gate the client
--      applies is decoration: anyone can call the REST endpoint directly.
--
--   3. The calculation snapshot and the transaction must be created together,
--      so a stored transaction always has the figures it was based on.

-- Short document code for the receipt reference, matching the mockups' style
-- (TXN-8924-DOA). Kept as a function so the mapping lives in one place.
create or replace function public.document_type_code(p_type public.document_type)
returns text
language sql
immutable
as $$
  select case p_type
    when 'deed_of_assignment' then 'DOA'
    when 'deed_of_conveyance' then 'DOC'
    when 'deed_of_gift'       then 'DOG'
    when 'contract_of_sale'   then 'COS'
    when 'deed_of_surrender'  then 'DOS'
    when 'deed_of_exchange'   then 'DOE'
    when 'mortgage_deed'      then 'MTG'
    when 'deed_of_release'    then 'DOR'
    when 'tenancy_agreement'  then 'TEN'
    when 'deed_of_lease'      then 'LSE'
    when 'deed_of_sub_lease'  then 'SLS'
    when 'power_of_attorney'  then 'POA'
  end;
$$;

create or replace function public.create_transaction(
  p_document_type public.document_type,
  p_consideration bigint,
  p_professional_fee bigint,
  p_branch_fee bigint,
  p_parties text,
  p_breakdown jsonb default '{}'::jsonb
)
returns table (transaction_id uuid, receipt_number text)
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
  v_receipt text;
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

  -- A receipt names a branch's bank account, and a certificate is issued by a
  -- branch. Without one there is nobody to pay and nobody to verify, so this
  -- fails with an explanation rather than producing an unpayable receipt.
  if v_profile.branch_id is null then
    raise exception 'You are not affiliated with a branch. Request affiliation from Edit Profile before generating a receipt.'
      using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = v_profile.branch_id;
  if not found then
    raise exception 'Your branch could not be found' using errcode = 'P0002';
  end if;

  -- Calculations are free forever; receipts and certificates are what a
  -- subscription buys. Checked here because a client side check protects
  -- nothing.
  if not exists (
    select 1 from public.subscriptions
    where user_id = v_actor
      and status = 'active'
      and expires_at > now()
  ) then
    raise exception 'An active subscription is required to generate a receipt. Calculations remain free.'
      using errcode = 'P0001';
  end if;

  if v_parties is null then
    raise exception 'Name the parties to the document' using errcode = '23514';
  end if;
  if p_consideration < 0 or p_professional_fee < 0 or p_branch_fee < 0 then
    raise exception 'Amounts cannot be negative' using errcode = '23514';
  end if;

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  -- The calculation snapshot. Nullable on the transaction, so a missing
  -- active scale degrades to a transaction without a snapshot rather than
  -- blocking the practitioner entirely.
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

  -- Reference the practitioner quotes on the bank transfer. Scoped per branch
  -- per year so two branches cannot collide.
  v_receipt := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, receipt_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, p_branch_fee, v_receipt, 'awaiting_payment'
  )
  returning id into v_txn_id;

  return query select v_txn_id, v_receipt;
end;
$$;

revoke execute on function public.create_transaction(
  public.document_type, bigint, bigint, bigint, text, jsonb
) from public, anon;

grant execute on function public.create_transaction(
  public.document_type, bigint, bigint, bigint, text, jsonb
) to authenticated, service_role;
