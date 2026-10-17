-- An administrator is a practitioner too.
--
-- Client decision, 17 October 2026, reversing 20260831120000. Total
-- separation meant somebody who runs a branch and also practises law kept two
-- accounts, one to administer and one for their own work. In practice that is
-- most branch administrators, and the second account bought nothing: the
-- protection that mattered was never "an administrator cannot transact" but
-- "nobody approves their own submission", and that check (issue_rbin, since
-- 20260815100000) is untouched here. An administrator's own submission still
-- needs another administrator of the branch.
--
-- What changes:
--
--   * create_transaction admits a branch administrator. A super administrator
--     is still refused, because that role belongs to no branch and there is no
--     branch to invoice through.
--   * The two transaction policies admit a branch administrator as owner.
--     enforce_transaction_update already routes an owner through the owner
--     rules before the administrator rules, so an administrator editing their
--     own row cannot verify or reject it by that route either.
--   * set_user_role approves a pending member while appointing them. The
--     super administrator is the one actor who can do both, the console says
--     so before they confirm, and refusing instead left them with a button
--     that appeared to do nothing.

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

drop policy if exists "practitioners create own transactions" on public.transactions;

create policy "practitioners create own transactions" on public.transactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.current_user_role() in ('branch_member', 'branch_admin')
  );

drop policy if exists "practitioner updates own transaction" on public.transactions;

create policy "practitioner updates own transaction" on public.transactions
  for update to authenticated
  using (
    user_id = auth.uid()
    and public.current_user_role() in ('branch_member', 'branch_admin')
  )
  with check (
    user_id = auth.uid()
    and public.current_user_role() in ('branch_member', 'branch_admin')
  );

-- ---------------------------------------------------------------------------
-- set_user_role, reproduced from 20260930100000
-- ---------------------------------------------------------------------------

create or replace function public.set_user_role(
  p_user_id uuid,
  p_role public.user_role
)
returns table (id uuid, full_name text, role public.user_role)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.profiles%rowtype;
begin
  if not public.is_privileged_actor() then
    raise exception 'Only a super administrator may change a role' using errcode = '42501';
  end if;

  if p_role not in ('branch_member', 'branch_admin') then
    raise exception 'A role may only be set to branch_member or branch_admin here'
      using errcode = '22023';
  end if;

  -- profiles.id, not id: the output column of the same name makes a bare
  -- "id" ambiguous (42702).
  select * into v_target from public.profiles where profiles.id = p_user_id for update;

  if not found then
    raise exception 'That person could not be found' using errcode = 'P0002';
  end if;

  if v_target.id = auth.uid() then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  if v_target.role = 'super_admin' then
    raise exception 'A super administrator''s role cannot be changed here'
      using errcode = '42501';
  end if;

  if p_role = 'branch_admin' and v_target.branch_id is null then
    raise exception 'This person is not attached to a branch, so cannot administer one'
      using errcode = '22023';
  end if;

  -- CHANGED. A pending member is approved by the appointment. A rejected one
  -- is not: the branch turned them down for a reason, and they should correct
  -- it and resubmit before anybody hands them the branch.
  if p_role = 'branch_admin' and v_target.membership_status = 'rejected' then
    raise exception 'Their branch rejected this membership request. They must correct it and resubmit first.'
      using errcode = '22023';
  end if;

  if v_target.role = p_role then
    raise exception 'They already hold that role' using errcode = '22023';
  end if;

  if p_role = 'branch_admin' and v_target.membership_status = 'pending' then
    update public.profiles
    set membership_status = 'approved',
        membership_reviewed_by = auth.uid(),
        membership_reviewed_at = now(),
        membership_rejection_reason = null
    where profiles.id = p_user_id;
  end if;

  update public.profiles
  set role = p_role
  where profiles.id = p_user_id;

  return query
  select p.id, p.full_name, p.role from public.profiles p where p.id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_transaction, reproduced from 20260930100000 with one check changed
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
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  -- CHANGED. Was branch_admin or super_admin. A branch administrator
  -- practises like anybody else; the platform role has no branch to invoice
  -- through.
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

  select id into v_scale_id from public.fee_scales where is_active limit 1;

  if v_scale_id is not null then
    insert into public.calculations (
      user_id, fee_scale_id, document_type, consideration,
      professional_fee, branch_fee, breakdown
    )
    values (
      v_actor, v_scale_id, p_document_type, p_consideration,
      p_professional_fee, p_branch_fee,
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
    p_consideration, p_professional_fee, p_branch_fee, v_invoice, 'awaiting_payment'
  )
  returning id into v_txn_id;

  perform set_config('app.issuing_receipt', 'off', true);

  return query select v_txn_id, v_invoice;
end;
$$;
