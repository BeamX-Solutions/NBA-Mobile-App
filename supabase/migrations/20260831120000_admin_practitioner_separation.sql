-- Total separation of the administrator and practitioner roles.
--
-- Client decision, 31 August 2026, after the first demo. An administrator
-- account administers and nothing else: it cannot calculate a fee into a
-- receipt, cannot submit a transaction, and cannot hold a certificate. A
-- person who both administers a branch and practises law uses two separate
-- accounts.
--
-- Why this is enforced in the database rather than the app:
--
--   The mobile app will stop offering administrators a practitioner surface,
--   but a UI rule protects nothing. Anyone holding an administrator's JWT can
--   call the REST endpoint directly. The rule has to hold at the point the row
--   is written, which is here.
--
-- Two gates, because they cover different routes to the same table:
--
--   1. create_transaction() is security definer, so it runs as the function
--      owner and RLS does not apply to it. It needs its own explicit check.
--   2. The insert policy covers a direct POST to /rest/v1/transactions, which
--      never passes through the function at all.
--
-- Separation of duties (block_self_approval, 15 August) becomes structurally
-- unreachable rather than merely checked: an administrator can no longer own a
-- transaction to approve. That check is deliberately left in place as defence
-- in depth, and because the service role is exempt from this one.

-- ---------------------------------------------------------------------------
-- Gate 1: the function
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

  -- Administrator accounts do not transact. Checked before the subscription
  -- gate so an administrator gets the real reason rather than being told to
  -- subscribe for something they will still not be allowed to do.
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

-- ---------------------------------------------------------------------------
-- Gate 2: the insert policy
--
-- Replaces "users create own transactions", which admitted any authenticated
-- caller inserting a row for themselves. Ownership is still required; the role
-- test is what is new. The service role bypasses RLS entirely and so is
-- unaffected, which keeps a future server side issuance path open.
-- ---------------------------------------------------------------------------

drop policy if exists "users create own transactions" on public.transactions;

create policy "practitioners create own transactions" on public.transactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.current_user_role() = 'branch_member'
  );

-- The owner-update policy gets the same treatment. Without it an administrator
-- who somehow held a transaction could still drive it through the lifecycle.
drop policy if exists "owner updates own transaction" on public.transactions;

create policy "practitioner updates own transaction" on public.transactions
  for update to authenticated
  using (
    user_id = auth.uid()
    and public.current_user_role() = 'branch_member'
  )
  with check (
    user_id = auth.uid()
    and public.current_user_role() = 'branch_member'
  );
