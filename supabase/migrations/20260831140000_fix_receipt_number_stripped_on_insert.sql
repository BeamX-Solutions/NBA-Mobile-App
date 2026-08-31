-- create_transaction() returned a receipt number it never stored.
--
-- enforce_transaction_insert nulls receipt_number unless is_privileged_actor()
-- is true. That resolves to is_service_actor(), which reads auth.role() — a
-- claim from the JWT. SECURITY DEFINER changes the database role a function
-- runs as; it does not change the JWT. So inside create_transaction the actor
-- is still 'authenticated' and still a branch_member, the trigger fires, and
-- the receipt number generated two statements earlier is set back to null.
--
-- The function returned that number to the app regardless, so the practitioner
-- was shown a reference like TXN-00001-DOA to quote on their bank transfer
-- while the stored row held null. The branch administrator reviewing the
-- payment saw no reference at all, and there was no way to match a transfer to
-- a submission. Every transaction created through the app since the function
-- shipped is affected. The sequence was consumed each time, so the numbering
-- advanced with no row carrying the value.
--
-- The fix is a transaction-local setting that only this function sets.
-- PostgREST allows a client to influence the request.* namespace and the role,
-- never an arbitrary app.* GUC, so a crafted REST call cannot claim to be
-- issuing a receipt. The trigger keeps stripping receipt_number for every
-- other insert path, which is what it exists to do.

-- ---------------------------------------------------------------------------
-- The trigger: honour the marker, strip everything else exactly as before
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

  -- Set only by create_transaction(), transaction-local, and unreachable from
  -- a client. Everything else a client must not choose is still overwritten.
  if coalesce(current_setting('app.issuing_receipt', true), '') = 'on' then
    new.status := 'awaiting_payment';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.bain := null;
    new.bain_issued_at := null;
    return new;
  end if;

  new.status := 'awaiting_payment';
  new.receipt_number := null;
  new.rejection_reason := null;
  new.verified_by := null;
  new.verified_at := null;
  new.bain := null;
  new.bain_issued_at := null;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The function: raise the marker around its own insert
-- ---------------------------------------------------------------------------

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

  if v_profile.role in ('branch_admin', 'super_admin') then
    raise exception 'Administrator accounts cannot submit transactions. Use a practitioner account.'
      using errcode = '42501';
  end if;

  if v_profile.branch_id is null then
    raise exception 'You are not affiliated with a branch. Request affiliation from Edit Profile before generating a receipt.'
      using errcode = 'P0001';
  end if;

  select * into v_branch from public.branches where id = v_profile.branch_id;
  if not found then
    raise exception 'Your branch could not be found' using errcode = 'P0002';
  end if;

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
  v_receipt := 'TXN-'
    || lpad(
         public.next_sequence_value(
           'receipt:' || v_branch.branch_code || ':' || extract(year from now())::text
         )::text, 5, '0')
    || '-' || public.document_type_code(p_document_type);

  perform set_config('app.issuing_receipt', 'on', true);

  insert into public.transactions (
    user_id, branch_id, calculation_id, parties, document_type,
    consideration, amount_payable, receipt_number, status
  )
  values (
    v_actor, v_profile.branch_id, v_calculation_id, v_parties, p_document_type,
    p_consideration, p_branch_fee, v_receipt, 'awaiting_payment'
  )
  returning id into v_txn_id;

  -- Lowered immediately. is_local is true so it would fall away at commit
  -- anyway, but leaving it raised for the rest of the transaction would let a
  -- later insert in the same transaction keep a client-supplied receipt.
  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_receipt;
end;
$$;
