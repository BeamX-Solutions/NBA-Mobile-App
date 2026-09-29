-- A branch approves each member who signs up to it.
--
-- Until now a valid branch code was all it took: the account became a full
-- branch member the moment it was created, and the branch only found out
-- afterwards, if it looked. A branch code is not a secret, so anybody who
-- knew one could register against that branch, draw invoices naming its bank
-- account and apply for certificates in its name.
--
-- Now a signup is pending until an administrator of that branch approves it.
-- Decided with the branch on 29 September 2026:
--
--   * A pending member can do nothing in the app until approved. The app
--     shows them a waiting screen; the database refuses them an invoice.
--   * A rejected member is shown the reason, may correct their details,
--     including their SCN and branch, and resubmit.
--   * Everyone registered before this migration is treated as approved.
--   * Administrators are not members awaiting approval: the checks below
--     pass them regardless of status.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Added with a default of approved so every existing profile is approved,
-- then the default is switched so every new signup starts pending.
alter table public.profiles
  add column membership_status text not null default 'approved'
    check (membership_status in ('pending', 'approved', 'rejected')),
  add column membership_reviewed_by uuid references public.profiles (id),
  add column membership_reviewed_at timestamptz,
  add column membership_rejection_reason text;

alter table public.profiles alter column membership_status set default 'pending';

comment on column public.profiles.membership_status is
  'pending until an administrator of the member''s branch approves or rejects the signup. Administrators are exempt.';

create index profiles_pending_membership_idx
  on public.profiles (branch_id, created_at)
  where membership_status = 'pending';

-- ---------------------------------------------------------------------------
-- membership_approved
-- ---------------------------------------------------------------------------

create or replace function public.membership_approved(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user_id
      and (role in ('branch_admin', 'super_admin') or membership_status = 'approved')
  );
$$;

-- ---------------------------------------------------------------------------
-- protect_profile_columns
-- ---------------------------------------------------------------------------
--
-- Reproduced from 20260813090100 with two changes. The membership columns are
-- the branch's to set, through review_membership and resubmit_membership,
-- which pass on a transaction-local marker as issue_rbin does. And the SCN is
-- the member's to correct until they are approved: a mistyped SCN is the
-- likeliest reason a branch rejects a signup, and a member who could not fix
-- it could never be approved.

create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_actor() then
    return new;
  end if;

  if coalesce(current_setting('app.deciding_membership', true), '') = 'on' then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.branch_id is distinct from old.branch_id
     or new.id is distinct from old.id
     or (new.scn is distinct from old.scn and old.membership_status = 'approved') then
    raise exception 'role, branch and SCN can only be changed by an administrator'
      using errcode = '42501';
  end if;

  if new.membership_status is distinct from old.membership_status
     or new.membership_reviewed_by is distinct from old.membership_reviewed_by
     or new.membership_reviewed_at is distinct from old.membership_reviewed_at
     or new.membership_rejection_reason is distinct from old.membership_rejection_reason then
    raise exception 'membership is decided by your branch' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- review_membership
-- ---------------------------------------------------------------------------

create or replace function public.review_membership(
  p_profile_id uuid,
  p_approve boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_target public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'That person could not be found' using errcode = 'P0002';
  end if;

  if not (v_role = 'super_admin'
          or (v_role = 'branch_admin' and v_target.branch_id = public.current_user_branch())) then
    raise exception 'Only an administrator of their branch can decide this' using errcode = '42501';
  end if;

  if v_target.id = v_actor then
    raise exception 'You cannot decide your own membership' using errcode = '42501';
  end if;

  if v_target.membership_status <> 'pending' then
    raise exception 'This request has already been decided' using errcode = 'P0001';
  end if;

  if not p_approve and nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required when rejecting, so they can correct it'
      using errcode = '23514';
  end if;

  perform set_config('app.deciding_membership', 'on', true);

  update public.profiles
  set membership_status = case when p_approve then 'approved' else 'rejected' end,
      membership_reviewed_by = v_actor,
      membership_reviewed_at = now(),
      membership_rejection_reason = case when p_approve then null else trim(p_reason) end
  where id = p_profile_id;

  perform set_config('app.deciding_membership', 'off', true);
end;
$$;

revoke execute on function public.review_membership(uuid, boolean, text) from public, anon;
grant execute on function public.review_membership(uuid, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- resubmit_membership
-- ---------------------------------------------------------------------------
--
-- A rejected member sends their request back to the queue. Name, phone and
-- SCN they correct on their profile first, directly. The branch is the one
-- detail they cannot set directly, so it is taken here, as a branch code
-- checked the same way signup checks it: the member may have registered
-- against the wrong branch, which is itself a reason to be rejected.

create or replace function public.resubmit_membership(p_branch_code text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_code text := nullif(upper(trim(p_branch_code)), '');
  v_branch_id uuid;
  v_state text;
begin
  if v_actor is null then
    raise exception 'You must be signed in' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if v_profile.membership_status <> 'rejected' then
    raise exception 'Only a rejected request can be resubmitted' using errcode = 'P0001';
  end if;

  if v_code is not null then
    select id, state into v_branch_id, v_state from public.branches where branch_code = v_code;
    if v_branch_id is null then
      raise exception 'Unknown branch code %', v_code using errcode = 'P0001';
    end if;
    if not public.branch_is_active(v_branch_id) then
      raise exception
        'That branch is not yet registered on this service. Ask your branch secretariat to contact the Association.'
        using errcode = 'P0001';
    end if;
  end if;

  perform set_config('app.deciding_membership', 'on', true);

  update public.profiles
  set membership_status = 'pending',
      membership_rejection_reason = null,
      membership_reviewed_by = null,
      membership_reviewed_at = null,
      branch_id = coalesce(v_branch_id, branch_id),
      practice_state = case when v_branch_id is null then practice_state else v_state end
  where id = v_actor;

  perform set_config('app.deciding_membership', 'off', true);
end;
$$;

revoke execute on function public.resubmit_membership(text) from public, anon;
grant execute on function public.resubmit_membership(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Guards on what a pending member could otherwise reach
-- ---------------------------------------------------------------------------
--
-- The app shows a pending member nothing but the waiting screen. These are
-- the database's own refusals, for a client that does not.

-- enforce_transaction_insert, reproduced from 20260929100000: an unapproved
-- member cannot write a transaction directly either.
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

  if not public.membership_approved() then
    raise exception 'Your branch has not approved your membership yet' using errcode = '42501';
  end if;

  new.remitted_at := null;
  new.remitted_by := null;
  new.remittance_reference := null;
  new.remitted_to := null;

  if coalesce(current_setting('app.issuing_receipt', true), '') = 'on' then
    new.status := 'awaiting_payment';
    new.rejection_reason := null;
    new.verified_by := null;
    new.verified_at := null;
    new.rbin := null;
    new.rbin_issued_at := null;
    return new;
  end if;

  -- A row written directly rather than through create_transaction does not
  -- get to name the branch's share of it.
  new.branch_fee := public.branch_fee_for(new.amount_payable);
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

-- set_user_role, reproduced from 20260922120000: nobody is made an
-- administrator of a branch that has not yet accepted them as a member.
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

  -- profiles.id, not id. This function returns a table whose first column is
  -- named id, which makes a bare "id" ambiguous between that output parameter
  -- and the column: plpgsql raises 42702 rather than guessing.
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

  -- An administrator administers a branch. Promoting somebody unattached
  -- would create an administrator of nothing, who would then see an empty
  -- console and no way to fix it.
  if p_role = 'branch_admin' and v_target.branch_id is null then
    raise exception 'This person is not attached to a branch, so cannot administer one'
      using errcode = '22023';
  end if;

  if p_role = 'branch_admin' and v_target.membership_status <> 'approved' then
    raise exception 'Their branch has not approved their membership yet'
      using errcode = '22023';
  end if;

  if v_target.role = p_role then
    raise exception 'They already hold that role' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role
  where profiles.id = p_user_id;

  return query
  select p.id, p.full_name, p.role from public.profiles p where p.id = p_user_id;
end;
$$;

-- create_transaction, reproduced from 20260929100000 with one check added.
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

  if v_profile.role in ('branch_admin', 'super_admin') then
    raise exception 'Administrator accounts cannot submit transactions. Use a practitioner account.'
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

  -- The client's money goes to the branch, and the branch sends the
  -- practitioner their share. With no account to send it to, the branch
  -- would be holding it with nowhere to put it.
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
  -- Both figures come from the client. The branch keeps the branch fee out of
  -- money paid into its own account, so it is checked here rather than
  -- trusted.
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
